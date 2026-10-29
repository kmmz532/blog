import { getPost, getToken, ensureDevSession, isValidSlug } from './github.js';
import { uploadImage } from './image.js';
import { parseArticle } from './frontmatter.js';
import { draftKey, hasDraft, readDraft, removeDraft, renderDrafts } from './drafts.js';
import { renderPreview } from './preview.js';
import { attachToolbar, insertImageMarkdown, altFrom } from './toolbar.js';
import { mountImageManager } from './images.js';
import { createExternalForm, isHttps } from './external.js';
import { nowJst } from './time.js';
import { setSaveState, showNotice } from './notice.js';
import { createTaxonomy } from './taxonomy.js';
import { createSlug } from './slug.js';
import { createThumb } from './thumb.js';
import { createDrafts } from './drafts.js';
import { createSave } from './save.js';

const $ = (id) => document.getElementById(id);
const SUMMARY_TARGET = 120;

// 画面の状態はこの 1 つにまとめる。記事の状態（kind・originalSlug・sha・aliases・extra）と、編集中の値・タイマー
const state = {
  // originalSlug: 保存済み記事の slug。新規は null。kind: 'article' | 'external'
  kind: 'article',
  originalSlug: null,
  sha: null,
  aliases: [],
  extra: [],
  // 選択中のタグ
  tags: [],
  // 選択中のカテゴリ（階層の順。先頭が一番上）
  categories: [],
  // 既存の記事から集計したカテゴリの階層。{ path, name, count } の配列（design.md §16）
  categoryNodes: [],
  knownTags: [],
  dirty: false,
  // 外部ページから自動で入れたサイト名（利用者が書き換えたら上書きしない）
  autoSource: '',
  // 利用者が日時を触ったら、外部ページからの自動入力で上書きしない
  dateTouched: false,
  // 復元するか選ぶまで保持する下書き { key, draft }
  pendingDraft: null,
  // カテゴリを選んだら、新規記事の件数順の既定値で上書きしない
  categoryPicked: false,
  // 手動で設定したサムネイルの URL（空なら自動）
  thumbImage: '',
  // 新規記事の slug が自動（投稿日時と種類から作る）か。手で書き換えたら false
  slugAuto: false,
  // 自動の slug の末尾の番号（2 桁）。自動のときだけ使う
  autoNumber: null,
  // 入力のあとに実行する処理。start() で差し込む
  schedule: { draft: () => {}, refresh: () => {} },
};
const taxonomy = createTaxonomy({ state, markDirty });
const slugs = createSlug({ state });
const externals = createExternalForm({ state, markDirty, slugs, taxonomy, updateSummaryCount, refreshPreview });
const thumbs = createThumb({ state, markDirty });

function debounce(fn, ms) {
  let timer;
  const run = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  run.cancel = () => clearTimeout(timer);
  return run;
}

// 公開・削除のあとに、待機中の下書き保存が走って下書きを復活させないよう止める
const cancelDraft = () => state.schedule.draft.cancel?.();
const drafts = createDrafts({ state, readForm, writeForm, refreshPreview, updateChrome });
const save = createSave({ state, readForm, validate, slugs, drafts, cancelDraft, updateChrome });

function markDirty() {
  state.dirty = true;
  setSaveState('unsaved', '未保存の変更あり');
  state.schedule.draft();
  state.schedule.refresh();
}

// ---- フォームとの変換 ----

function readForm() {
  return {
    kind: state.kind,
    slug: $('f-slug').value.trim(),
    title: $('f-title').value.trim(),
    date: $('f-date').value.slice(0, 16),
    categories: [...state.categories],
    tags: [...state.tags],
    summary: $('f-summary').value.trim(),
    body: $('f-body').value,
    url: $('f-external').value.trim(),
    source: $('f-source').value.trim(),
    image: state.thumbImage,
  };
}

function writeForm(fields) {
  setKind(fields.kind ?? 'article');
  $('f-slug').value = fields.slug;
  $('f-title').value = fields.title;
  $('f-date').value = fields.date;
  // 新規は、空か自動の形のままなら自動のまま。保存済みの記事は触らない
  if (state.originalSlug === null) {
    // 自動の形の slug（下書きの復元を含む）は、その番号を引き継いで自動のままにする
    const match = slugs.AUTO_SLUG_RE.exec(fields.slug);
    state.slugAuto = !fields.slug || Boolean(match);
    state.autoNumber = match ? match[1] : null;
    slugs.syncAutoSlug();
  }
  // 旧形式の下書き（category が 1 つだけ）も読める
  state.categories = [...(fields.categories ?? [fields.category ?? 'tech'])];
  taxonomy.renderCategories();
  state.tags = [...fields.tags];
  taxonomy.renderSelectedTags();
  taxonomy.renderTagSuggestions('');
  $('f-summary').value = fields.summary;
  $('summary-details').open = Boolean(fields.summary);
  state.thumbImage = fields.image ?? '';
  $('thumb-details').open = Boolean(state.thumbImage);
  $('f-body').value = fields.body;
  $('f-external').value = fields.url ?? '';
  $('f-source').value = fields.source ?? '';
  updateSummaryCount();
  updateSummaryHint();
  autosize();
}

// 最初の誤りを { field（入力欄の id）, message } で返す。問題が無ければ null
function validate(fields) {
  const fail = (field, message) => ({ field, message });
  if (!isValidSlug(fields.slug)) {
    return fail('f-slug', 'slug は英小文字・数字・ハイフンのみ（1〜80 文字）で入力してください。');
  }
  // 外部記事のタイトルと概要は空でもよい（ビルド時に OGP で補う）
  if (fields.kind !== 'external' && !fields.title) return fail('f-title', 'タイトルを入力してください。');
  if (!fields.categories.length) return fail('f-category', 'カテゴリを入力してください。');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fields.date)) return fail('f-date', '投稿日時を入力してください。');
  if (fields.kind === 'external') {
    if (!isHttps(fields.url)) return fail('f-external', '外部記事の URL は https:// で始まるものを入れてください。');
    if (!fields.source) return fail('f-source', 'サイト名を入力してください。');
  }
  return null;
}

// 種類は保存後に変えられないので、既存記事ではタブを隠す
function isWide() {
  return window.matchMedia('(min-width: 1400px)').matches;
}

function setKind(kind) {
  state.kind = kind;
  const external = kind === 'external';
  $('editor-main').dataset.kind = external ? 'external' : 'article';
  $('external-fields').hidden = !external;
  $('toolbar').hidden = external;
  $('f-body').hidden = external;
  $('view-edit').hidden = external;
  $('view-preview').hidden = external;
  $('view-split').hidden = external || !isWide();
  for (const button of document.querySelectorAll('#kind-tabs button')) {
    button.setAttribute('aria-pressed', String(button.dataset.kind === kind));
  }
  setView(external ? 'preview' : isWide() ? 'split' : 'edit');
}

function setView(view) {
  $('editor-main').dataset.view = view;
  // 記事はプレビューだけの表示ではタイトル欄を出さない（タイトルはプレビューの見出しで確認できる）。外部記事は手で直すので残す
  $('f-title').hidden = view === 'preview' && state.kind === 'article';
  $('editor-main').classList.toggle('split', view === 'split');
  $('view-edit').setAttribute('aria-pressed', String(view === 'edit'));
  $('view-preview').setAttribute('aria-pressed', String(view === 'preview'));
  $('view-split').setAttribute('aria-pressed', String(view === 'split'));
  refreshPreview();
}

// ---- 概要（自動生成の表示。保存時の規則は partial external-meta.html と同じ） ----

function updateSummaryCount() {
  const length = [...$('f-summary').value].length;
  const count = $('summary-count');
  count.textContent = `${length} / ${SUMMARY_TARGET}`;
  count.classList.toggle('warn', length > SUMMARY_TARGET);
}

// 本文から概要を作る。<pre> を除き、文字を整え、120 字で切る
function autoSummary(markdown) {
  if (!window.marked || !markdown.trim()) return '';
  const template = document.createElement('template');
  template.innerHTML = window.marked.parse(markdown);
  template.content.querySelectorAll('pre').forEach((el) => el.remove());
  const text = template.content.textContent.replace(/\s+/g, ' ').trim();
  const chars = [...text];
  return chars.length > SUMMARY_TARGET ? `${chars.slice(0, SUMMARY_TARGET).join('')}…` : text;
}

function updateSummaryHint() {
  $('f-summary').placeholder = autoSummary($('f-body').value) || '（本文から自動生成されます）';
}

// 取っ手で手動に変えた高さ（px）。autosize が書いた値とは違う高さになったときだけ覚える
let manualHeight = null;
let autoHeight = null;

function rememberManualHeight() {
  const body = $('f-body');
  if (body.style.height !== autoHeight) manualHeight = body.offsetHeight;
}

// 並べて表示のときは、プレビューの高さを本文欄と同じにする（取っ手は本文欄の 1 つだけ）
function fitPreviewToBody() {
  const split = $('editor-main').dataset.view === 'split';
  $('preview').style.height = split ? `${$('f-body').offsetHeight}px` : '';
}

function autosize() {
  const body = $('f-body');
  // 高さを一度 auto に縮めるとページが短くなってスクロール位置が飛ぶので、前後で戻す
  const { scrollX, scrollY } = window;
  const innerTop = body.scrollTop;
  body.style.height = 'auto';
  // 手動の高さがあればそれを使う（内容が多ければ本文欄の中でスクロールする）。無ければ内容の高さ
  autoHeight = `${manualHeight ?? body.scrollHeight}px`;
  body.style.height = autoHeight;
  body.scrollTop = innerTop;
  window.scrollTo(scrollX, scrollY);
}

// 並べて表示のとき、本文欄とプレビューのスクロール位置を割合で合わせる。
// 片方を動かすと、もう片方の scroll イベントが返ってくるので、そのときは無視する
function attachScrollSync() {
  const body = $('f-body');
  const preview = $('preview');
  let moving = false;
  const follow = (from, to) => () => {
    if (moving) return;
    const range = from.scrollHeight - from.clientHeight;
    if (range <= 0) return;
    moving = true;
    to.scrollTop = (from.scrollTop / range) * (to.scrollHeight - to.clientHeight);
    requestAnimationFrame(() => {
      moving = false;
    });
  };
  body.addEventListener('scroll', follow(body, preview));
  preview.addEventListener('scroll', follow(preview, body));
}

function refreshPreview() {
  const fields = readForm();
  updateSummaryHint();
  thumbs.renderThumb();
  if (fields.kind === 'external') externals.renderExternalCard(fields);
  else renderPreview(fields.body, null, $('preview'));
  fitPreviewToBody();
}

// ---- 画面状態 ----

function updateChrome() {
  const saved = state.originalSlug !== null;
  $('save').textContent = saved ? '更新' : '公開';
  slugs.updateSlugAuto();
  $('kind-tabs').hidden = saved;
  $('danger-details').hidden = !saved;
  const back = $('back-link');
  back.href = saved && state.kind === 'article' ? `/posts/${state.originalSlug}/` : '/';
}

function failStart(message) {
  showNotice('error', message);
  $('save').disabled = true;
  $('danger-details').hidden = true;
}

// ---- 初期化 ----

async function load() {
  const slug = new URLSearchParams(location.search).get('slug');
  let server;

  if (slug !== null) {
    if (!isValidSlug(slug)) {
      failStart('slug の形式が正しくありません。');
      return;
    }
    let post;
    try {
      post = await getPost(slug);
    } catch (error) {
      failStart(error.message);
      return;
    }
    if (!post) {
      failStart(`記事「${slug}」が見つかりません。`);
      return;
    }
    let parsed;
    try {
      parsed = parseArticle(post.text);
    } catch (error) {
      failStart(error.message);
      return;
    }
    state.kind = parsed.kind;
    state.originalSlug = slug;
    state.sha = post.sha;
    state.aliases = parsed.aliases;
    state.extra = parsed.extra;
    server = { ...parsed.fields, kind: parsed.kind, slug };
  } else {
    server = {
      kind: 'article',
      slug: '',
      title: '',
      date: nowJst(),
      categories: ['tech'],
      tags: [],
      summary: '',
      body: '',
      url: '',
      source: '',
    };
    server.slug = slugs.autoSlugFor(server);
  }

  writeForm(server);

  const key = draftKey(state.originalSlug);
  if (hasDraft(key)) {
    const draft = readDraft(key);
    // 壊れた下書きは捨てる。まともな下書きは復元か破棄を選ばれるまで残す
    if (draft) drafts.showDraftNotice(key, draft);
    else removeDraft(key);
  }

  updateChrome();
  refreshPreview();
  renderDrafts($('drafts'));
  taxonomy.loadIndex();
}

function start() {
  const form = $('post-form');
  state.schedule.draft = debounce(drafts.saveDraft, 1000);
  state.schedule.refresh = debounce(refreshPreview, 300);

  form.addEventListener('submit', save.publish);
  form.addEventListener('input', (event) => {
    if (event.target.id === 'f-external') externals.onExternalUrlInput();
    if (event.target.id === 'f-date') {
      state.dateTouched = true;
      slugs.syncAutoSlug();
    }
    if (event.target.id === 'f-summary') updateSummaryCount();
    if (event.target.id === 'f-body') autosize();
    markDirty();
  });
  externals.attach();
  slugs.attach();
  attachScrollSync();
  new ResizeObserver(() => {
    rememberManualHeight();
    fitPreviewToBody();
  }).observe($('f-body'));

  for (const button of document.querySelectorAll('#kind-tabs button')) {
    button.addEventListener('click', () => {
      setKind(button.dataset.kind);
      slugs.syncAutoSlug();
      markDirty();
    });
  }
  $('view-edit').addEventListener('click', () => setView('edit'));
  $('view-preview').addEventListener('click', () => setView('preview'));
  $('view-split').addEventListener('click', () => setView('split'));
  // 幅が足りなくなったら並べて表示を解除する（ボタンも隠れて戻せなくなるため）
  const wide = window.matchMedia('(min-width: 1400px)');
  wide.addEventListener('change', () => {
    if (state.kind === 'external') return;
    $('view-split').hidden = !wide.matches;
    if (!wide.matches && $('editor-main').dataset.view === 'split') setView('edit');
  });

  taxonomy.attach();
  attachToolbar({
    textarea: $('f-body'),
    toolbar: $('toolbar'),
    fileInput: $('f-image'),
    upload: uploadImage,
    onError: (message) => showNotice('error', message),
  });

  const images = mountImageManager($('image-manager'), {
    onPick: (url) => insertImageMarkdown($('f-body'), url),
    onUploaded: (url, file) => insertImageMarkdown($('f-body'), url, altFrom(file)),
  });
  // 画像の一覧はダイアログ。初めて開いたときに読み込む。挿入しても閉じない（続けて入れられる）
  let imagesLoaded = false;
  $('open-images').addEventListener('click', () => {
    $('images-dialog').showModal();
    if (!imagesLoaded) images.load();
    imagesLoaded = true;
  });
  $('images-close').addEventListener('click', () => $('images-dialog').close());
  // 枠の外（背景）を押したら閉じる
  $('images-dialog').addEventListener('click', (event) => {
    if (event.target === $('images-dialog')) $('images-dialog').close();
  });

  thumbs.attach();
  $('delete').addEventListener('click', save.removePost);
  $('discard').addEventListener('click', () => {
    if (!confirm('この記事の下書きを破棄して、保存済みの内容を読み直します。')) return;
    removeDraft(draftKey(state.originalSlug));
    state.dirty = false;
    location.reload();
  });

  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      drafts.saveDraft();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  load();
}

await ensureDevSession();
if (getToken()) {
  start();
} else {
  location.replace(`/login/?return=${encodeURIComponent(location.pathname + location.search)}`);
}
