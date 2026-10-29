import { getPost, savePost, deletePost, getToken, ensureDevSession, isValidSlug, ConflictError } from './github.js';
import { uploadImage } from './image.js';
import { parseArticle, buildArticle, buildExternal } from './frontmatter.js';
import { draftKey, hasDraft, readDraft, writeDraft, removeDraft, renderDrafts } from './drafts.js';
import { renderPreview } from './preview.js';
import { attachToolbar } from './toolbar.js';
import { fetchExternalMeta } from './external.js';
import { nowJst } from './time.js';
import { recordSave, recordDelete } from './pending.js';
import { setSaveState, showNotice, hideNotice } from './notice.js';
import { createTaxonomy } from './taxonomy.js';
import { createSlug } from './slug.js';
import { createThumb } from './thumb.js';

const $ = (id) => document.getElementById(id);
const SUMMARY_TARGET = 120;
const SOURCE_NAMES = { 'zenn.dev': 'Zenn', 'qiita.com': 'Qiita', 'note.com': 'note' };

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
  // 既存の記事から集計したもの。{ name, count } の配列（件数の多い順）
  knownCategories: [],
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
const AUTO_SLUG_TRIES = 5;
const taxonomy = createTaxonomy({ state, markDirty });
const slugs = createSlug({ state });
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

function errorMessage(error, creating) {
  if (error instanceof ConflictError) {
    return creating
      ? '同じ slug の記事が既にあります。別の slug にしてください。'
      : '他で更新されています。再読み込みしてください（上書きはしていません）。';
  }
  return error.message;
}

function markDirty() {
  state.dirty = true;
  setSaveState('unsaved', '未保存の変更あり');
  state.schedule.draft();
  state.schedule.refresh();
}

function isHttps(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

// ---- フォームとの変換 ----

function readForm() {
  return {
    kind: state.kind,
    slug: $('f-slug').value.trim(),
    title: $('f-title').value.trim(),
    date: $('f-date').value.slice(0, 16),
    category: taxonomy.currentCategory(),
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
  taxonomy.renderCategories(fields.category);
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

function autosize() {
  const body = $('f-body');
  body.style.height = 'auto';
  body.style.height = `${body.scrollHeight}px`;
}

// ---- 外部記事 ----

function sourceFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SOURCE_NAMES[host] ?? host;
  } catch {
    return '';
  }
}

// URL を入れたとき、サイト名が空か自動入力のままなら既定値を入れる
function onExternalUrlInput() {
  const source = $('f-source');
  const guess = sourceFromUrl($('f-external').value.trim());
  if (guess && (source.value === '' || source.value === state.autoSource)) {
    source.value = guess;
    state.autoSource = guess;
  }
}

// URL の確定時に外部ページから項目を取る。入力済みの項目は上書きしない
async function autofillExternal() {
  const url = $('f-external').value.trim();
  if (!isHttps(url)) return;
  showNotice('info', '外部ページから項目を取得しています…');
  const meta = await fetchExternalMeta(url);
  if (!meta) {
    showNotice('info', '自動取得できませんでした（手入力してください）。');
    return;
  }

  if (!$('f-title').value && meta.title) $('f-title').value = meta.title;
  if (!$('f-summary').value && meta.summary) {
    $('f-summary').value = meta.summary;
    $('summary-details').open = true;
    updateSummaryCount();
  }
  if (!state.tags.length && meta.tags.length) {
    state.tags = meta.tags.filter(Boolean);
    taxonomy.renderSelectedTags();
    taxonomy.renderTagSuggestions('');
  }
  if (!state.dateTouched && meta.date) {
    $('f-date').value = meta.date;
    slugs.syncAutoSlug();
  }
  const source = $('f-source');
  if (meta.source && (source.value === '' || source.value === state.autoSource)) {
    source.value = meta.source;
    state.autoSource = meta.source;
  }
  markDirty();
  showNotice('info', '外部ページから項目を取得しました。内容を確認してください。');
  refreshPreview();
}

function renderExternalCard(fields) {
  const article = document.createElement('article');
  article.className = 'carditem';

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const date = document.createElement('time');
  date.textContent = fields.date.slice(0, 10).replaceAll('-', '.');
  meta.append(date);
  if (fields.category) {
    const category = document.createElement('span');
    category.textContent = fields.category;
    meta.append(category);
  }

  const heading = document.createElement('h2');
  heading.className = 'card-title';
  heading.textContent = fields.title || fields.url || '（無題）';
  // 外部リンクの表示はタイトルの横に出す（一覧カードと同じ）
  const source = document.createElement('span');
  source.className = 'card-external';
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-arrow-up-right-from-square';
  icon.setAttribute('aria-hidden', 'true');
  source.append(icon, ` ${fields.source || ''}`);
  heading.append(source);

  article.append(meta, heading);
  if (fields.summary) {
    const excerpt = document.createElement('p');
    excerpt.className = 'card-excerpt';
    excerpt.textContent = fields.summary;
    article.append(excerpt);
  }
  if (fields.tags.length) {
    const box = document.createElement('div');
    box.className = 'card-tags';
    for (const tag of fields.tags) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `#${tag}`;
      box.append(chip);
    }
    article.append(box);
  }
  $('preview').replaceChildren(article);
}

function refreshPreview() {
  const fields = readForm();
  updateSummaryHint();
  thumbs.renderThumb();
  if (fields.kind === 'external') renderExternalCard(fields);
  else renderPreview(fields.body, fields.title, $('preview'));
}

// ---- 下書き ----

function saveDraft() {
  // 復元か破棄を選ぶまでは、残っている下書きを上書きしない
  if (state.pendingDraft) return;
  const payload = {
    ...readForm(),
    sha: state.sha,
    aliases: state.aliases,
    extra: state.extra,
    savedAt: new Date().toISOString(),
  };
  if (!writeDraft(draftKey(state.originalSlug), payload)) {
    showNotice('error', '下書きを保存できませんでした。');
  } else {
    const time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    setSaveState('draft', `下書き保存 ${time}`);
  }
  renderDrafts($('drafts'));
}

// 下書きのお知らせ。選ぶまでは保存済みの内容を出したままにする
function showDraftNotice(key, draft) {
  state.pendingDraft = { key, draft };
  const time = new Date(draft.savedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  // 選ぶまで消えない（お知らせ欄の [復元する] [破棄する]）
  showNotice('info', `この記事の下書きがあります（${time} 保存）`, [
    { label: '復元する', primary: true, onClick: restoreDraft },
    { label: '破棄する', onClick: discardDraft },
  ]);
}

function closeDraftNotice() {
  state.pendingDraft = null;
  hideNotice();
}

function restoreDraft() {
  if (!state.pendingDraft) return;
  const { draft } = state.pendingDraft;
  closeDraftNotice();
  writeForm(draft);
  state.categoryPicked = true;
  state.sha = draft.sha ?? null;
  state.aliases = draft.aliases ?? [];
  state.extra = draft.extra ?? [];
  state.dirty = true;
  updateChrome();
  refreshPreview();
  showNotice('info', '下書きを復元しました。');
}

function discardDraft() {
  if (!state.pendingDraft) return;
  removeDraft(state.pendingDraft.key);
  closeDraftNotice();
  renderDrafts($('drafts'));
  showNotice('info', '下書きを破棄しました。');
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

// ---- 保存・削除 ----

function serialize(fields, aliases) {
  return fields.kind === 'external'
    ? buildExternal(fields, state.extra)
    : buildArticle(fields, aliases, state.extra);
}

// slug 変更: 新 slug を作ってから旧ファイルを消す。旧ファイルの削除に失敗したら警告を返す
async function renameSlug(fields) {
  const oldSlug = state.originalSlug;
  const oldSha = state.sha;
  // 外部記事は本文がないので aliases も付けない
  const aliases = fields.kind === 'external' ? [] : [...new Set([...state.aliases, `/posts/${oldSlug}/`])];

  // sha を付けない。同名があれば ConflictError で中止される
  const sha = await savePost(fields.slug, serialize(fields, aliases));
  state.aliases = aliases;
  state.sha = sha;

  try {
    await deletePost(oldSlug, oldSha);
    return null;
  } catch (error) {
    return `旧ファイル（${oldSlug}）を削除できませんでした。手動で削除してください。（${error.message}）`;
  }
}

// 新規の保存。自動の slug が既存と重なったら番号を振り直して再試行する。手入力の slug は付け直さない
async function saveNewPost(fields, auto) {
  const attempts = auto ? AUTO_SLUG_TRIES : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (auto) {
      if (attempt > 1) state.autoNumber = slugs.randomNumber();
      fields.slug = slugs.autoSlugFor(fields);
    }
    try {
      return { slug: fields.slug, sha: await savePost(fields.slug, serialize(fields, state.aliases)) };
    } catch (error) {
      if (!auto || !(error instanceof ConflictError)) throw error;
    }
  }
  throw new Error(`自動の slug が ${AUTO_SLUG_TRIES} 回続けて既存と重なったため決められませんでした。slug を手で入力してください。`);
}

async function publish(event) {
  event.preventDefault();
  const fields = readForm();
  const invalid = validate(fields);
  if (invalid) {
    if (invalid.field === 'f-slug') slugs.setSlugError(invalid.message);
    showNotice('error', `入力に誤りがあります。${invalid.message}`);
    $(invalid.field).focus();
    return;
  }

  const creating = state.originalSlug === null;
  const auto = creating && state.slugAuto;
  const slugChanged = !creating && fields.slug !== state.originalSlug;
  const oldKey = draftKey(state.originalSlug);
  const oldSlug = state.originalSlug;

  $('save').disabled = true;
  cancelDraft();
  setSaveState('publishing', '公開中…');
  try {
    let warning = null;
    if (slugChanged) {
      warning = await renameSlug(fields);
    } else if (creating) {
      const saved = await saveNewPost(fields, auto);
      state.sha = saved.sha;
      $('f-slug').value = saved.slug;
    } else {
      state.sha = await savePost(fields.slug, serialize(fields, state.aliases), state.sha);
    }

    state.originalSlug = fields.slug;
    removeDraft(oldKey);
    closeDraftNotice();
    // 反映待ちの控え。slug を変えた場合は旧 slug を削除の控えにする（旧ファイルの削除に失敗していなければ）
    recordSave(fields.slug, {
      fields,
      isNew: creating || slugChanged,
      oldSlug: slugChanged ? oldSlug : null,
    });
    if (slugChanged && !warning) recordDelete(oldSlug);
    state.dirty = false;
    history.replaceState(null, '', `/edit/?slug=${encodeURIComponent(fields.slug)}`);
    updateChrome();
    renderDrafts($('drafts'));

    setSaveState('published', `公開済み ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`);
    if (warning) showNotice('error', warning);
    else showNotice('success', '公開しました。1〜2分後に反映されます。');
  } catch (error) {
    showNotice('error', errorMessage(error, creating || slugChanged));
    setSaveState('unsaved', '未保存の変更あり');
  } finally {
    $('save').disabled = false;
  }
}

async function removePost() {
  const slug = state.originalSlug;
  if (slug === null) return;
  const typed = prompt(`この記事を削除します。確認のため slug「${slug}」を入力してください。`);
  if (typed === null) return;
  if (typed !== slug) {
    showNotice('error', 'slug が一致しないため削除しませんでした。');
    return;
  }

  $('delete').disabled = true;
  cancelDraft();
  try {
    await deletePost(slug, state.sha);
    recordDelete(slug);
    removeDraft(draftKey(slug));
    state.dirty = false;
    location.assign('/');
  } catch (error) {
    showNotice('error', errorMessage(error, false));
    $('delete').disabled = false;
  }
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
      category: 'tech',
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
    if (draft) showDraftNotice(key, draft);
    else removeDraft(key);
  }

  updateChrome();
  refreshPreview();
  renderDrafts($('drafts'));
  taxonomy.loadIndex();
}

function start() {
  const form = $('post-form');
  state.schedule.draft = debounce(saveDraft, 1000);
  state.schedule.refresh = debounce(refreshPreview, 300);

  form.addEventListener('submit', publish);
  form.addEventListener('input', (event) => {
    if (event.target.id === 'f-external') onExternalUrlInput();
    if (event.target.id === 'f-date') {
      state.dateTouched = true;
      slugs.syncAutoSlug();
    }
    if (event.target.id === 'f-summary') updateSummaryCount();
    if (event.target.id === 'f-body') autosize();
    markDirty();
  });
  $('f-external').addEventListener('change', autofillExternal);
  slugs.attach();

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

  thumbs.attach();
  $('delete').addEventListener('click', removePost);
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
      saveDraft();
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
