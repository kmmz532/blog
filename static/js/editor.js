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

// slug 欄の直下のエラー。空文字で消す
function setSlugError(message) {
  $('f-slug').setAttribute('aria-invalid', String(Boolean(message)));
  $('f-slug-error').textContent = message;
  $('f-slug-error').hidden = !message;
}

// 自動の slug: 通常記事は YYYY-MM-DD-NN、外部記事は ext-YYYY-MM-DD-NN（NN は 00〜99 の乱数）
const AUTO_SLUG_RE = /^(?:ext-)?\d{4}-\d{2}-\d{2}-(\d{2})$/;

function randomNumber() {
  return String(Math.floor(Math.random() * 100)).padStart(2, '0');
}

function autoSlugFor(fields) {
  state.autoNumber ??= randomNumber();
  return `${fields.kind === 'external' ? 'ext-' : ''}${fields.date.slice(0, 10)}-${state.autoNumber}`;
}

function updateSlugAuto() {
  $('slug-auto').hidden = state.originalSlug !== null || !state.slugAuto;
}

// 自動のままなら、投稿日時か記事の種類が変わったときに slug を作り直す（保存はしない）
function syncAutoSlug() {
  if (state.originalSlug !== null || !state.slugAuto) return;
  const date = $('f-date').value;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(date)) return;
  $('f-slug').value = autoSlugFor({ kind: state.kind, date });
  setSlugError('');
}

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

// ---- カテゴリ（既存から 1 つ選ぶ。「＋ 新規」で作る） ----

function currentCategory() {
  return $('category-chips').querySelector('[aria-pressed="true"]')?.dataset.value ?? 'tech';
}

function renderCategories(selected) {
  const names = state.knownCategories.map((item) => item.name);
  if (selected && !names.includes(selected)) names.push(selected);
  const box = $('category-chips');
  box.replaceChildren(
    ...names.map((name) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice';
      button.dataset.value = name;
      button.textContent = name;
      button.setAttribute('aria-pressed', String(name === selected));
      button.addEventListener('click', () => {
        state.categoryPicked = true;
        renderCategories(name);
        markDirty();
      });
      return button;
    }),
  );
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'choice';
  add.textContent = '＋ 新規';
  add.addEventListener('click', () => {
    $('category-new').hidden = false;
    $('f-category-new').focus();
  });
  box.append(add);
}

function commitNewCategory() {
  const name = $('f-category-new').value.trim();
  $('f-category-new').value = '';
  $('category-new').hidden = true;
  if (!name) return;
  if (name.includes(',')) {
    showNotice('error', 'カテゴリ名に , は使えません。');
    return;
  }
  const existing = state.knownCategories.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!existing) state.knownCategories.push({ name, count: 0 });
  state.categoryPicked = true;
  renderCategories(existing?.name ?? name);
  markDirty();
}

// ---- タグ（選択中のタグと、既存タグの候補） ----

// 大文字小文字だけ違うときは既存のほうを使う
function normalizeTagName(raw) {
  const name = raw.trim().replace(/^#/, '');
  if (!name || name.includes(',')) return null;
  const existing = state.knownTags.find((item) => item.name.toLowerCase() === name.toLowerCase());
  return existing?.name ?? name;
}

function renderSelectedTags() {
  const box = $('tag-selected');
  box.replaceChildren(
    ...state.tags.map((tag, index) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `#${tag}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `${tag} を外す`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        state.tags.splice(index, 1);
        renderSelectedTags();
        renderTagSuggestions($('f-tag-entry').value);
        markDirty();
      });
      chip.append(remove);
      return chip;
    }),
  );
}

// 入力が空なら件数の多い 20 件、文字を打ったら全件から入力文字を含むものを出す。押すと選択・解除
function renderTagSuggestions(filter) {
  const needle = filter.trim().toLowerCase();
  const box = $('tag-suggest');
  const matches = needle
    ? state.knownTags.filter((item) => item.name.toLowerCase().includes(needle))
    : state.knownTags.slice(0, 20);
  box.replaceChildren(
    ...matches.map((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice';
      button.textContent = `#${item.name} (${item.count})`;
      button.setAttribute('aria-pressed', String(state.tags.includes(item.name)));
      button.addEventListener('click', () => {
        if (state.tags.includes(item.name)) state.tags = state.tags.filter((tag) => tag !== item.name);
        else state.tags.push(item.name);
        renderSelectedTags();
        renderTagSuggestions($('f-tag-entry').value);
        markDirty();
      });
      return button;
    }),
  );
}

function addTagFromEntry() {
  const entry = $('f-tag-entry');
  const raw = entry.value;
  const name = normalizeTagName(raw);
  entry.value = '';
  if (name === null) {
    if (raw.trim()) showNotice('error', 'タグ名に , は使えません。');
    return;
  }
  if (!state.tags.includes(name)) {
    state.tags.push(name);
    renderSelectedTags();
    markDirty();
  }
  renderTagSuggestions('');
}

function attachTagInput() {
  const entry = $('f-tag-entry');
  entry.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTagFromEntry();
    } else if (event.key === 'Backspace' && entry.value === '' && state.tags.length) {
      state.tags.pop();
      renderSelectedTags();
      renderTagSuggestions('');
      markDirty();
    }
  });
  entry.addEventListener('input', () => renderTagSuggestions(entry.value));
  entry.addEventListener('blur', () => {
    if (entry.value.trim()) addTagFromEntry();
  });
}

// 既存の記事から、カテゴリとタグの件数を集計する。失敗しても手入力は続けられる
async function loadIndex() {
  try {
    const res = await fetch($('post-form').dataset.indexUrl, { cache: 'no-store' });
    if (!res.ok) return;
    const posts = await res.json();
    const categoryCounts = new Map();
    const tagCounts = new Map();
    for (const post of posts) {
      for (const category of post.categories ?? []) {
        categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      }
      for (const tag of post.tags ?? []) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
    state.knownCategories = [...categoryCounts].map(([name, count]) => ({ name, count })).sort(byCount);
    state.knownTags = [...tagCounts].map(([name, count]) => ({ name, count })).sort(byCount);
    // 新規記事は件数が一番多いカテゴリを初期値にする（既存が無ければ tech）
    const keepCurrent = state.originalSlug !== null || state.categoryPicked;
    renderCategories(keepCurrent ? currentCategory() : (state.knownCategories[0]?.name ?? 'tech'));
    renderTagSuggestions($('f-tag-entry').value);
  } catch {
    // 一覧が出なくても、新規に入力すれば使える
  }
}

// ---- フォームとの変換 ----

function readForm() {
  return {
    kind: state.kind,
    slug: $('f-slug').value.trim(),
    title: $('f-title').value.trim(),
    date: $('f-date').value.slice(0, 16),
    category: currentCategory(),
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
    const match = AUTO_SLUG_RE.exec(fields.slug);
    state.slugAuto = !fields.slug || Boolean(match);
    state.autoNumber = match ? match[1] : null;
    syncAutoSlug();
  }
  renderCategories(fields.category);
  state.tags = [...fields.tags];
  renderSelectedTags();
  renderTagSuggestions('');
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
    renderSelectedTags();
    renderTagSuggestions('');
  }
  if (!state.dateTouched && meta.date) {
    $('f-date').value = meta.date;
    syncAutoSlug();
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

// ---- サムネイル（手動設定があればそれ。無ければ自動。design.md §3・§11.6） ----

const BODY_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;

// 今どう決まっているかを返す。自動の画像は本文の最初の画像（外部記事は OGP なのでプレビューなし）
function thumbStatus() {
  if (state.thumbImage) return { url: state.thumbImage, label: '手動' };
  if (state.kind === 'external') return { url: '', label: '自動: OGP の画像（ビルド時に取得）' };
  const first = [...$('f-body').value.matchAll(BODY_IMAGE_RE)][0];
  if (first) return { url: first[1], label: '自動: 本文の最初の画像' };
  return { url: '', label: 'なし' };
}

function renderThumb() {
  const { url, label } = thumbStatus();
  const preview = $('thumb-preview');
  preview.hidden = !url;
  preview.src = url;
  $('thumb-state').textContent = label;
  $('thumb-pick').hidden = state.kind === 'external';
  $('thumb-choices').hidden = true;
}

// 本文中の画像を並べ、押したものを手動のサムネイルにする
function showThumbChoices() {
  const box = $('thumb-choices');
  const urls = [...new Set([...$('f-body').value.matchAll(BODY_IMAGE_RE)].map((match) => match[1]))];
  box.replaceChildren(
    ...urls.map((url) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'thumb-choice';
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.width = 64;
      img.height = 64;
      img.loading = 'lazy';
      button.append(img);
      button.addEventListener('click', () => {
        state.thumbImage = url;
        box.hidden = true;
        renderThumb();
        markDirty();
      });
      return button;
    }),
  );
  if (!urls.length) box.textContent = '本文に画像がありません。';
  box.hidden = false;
}

function refreshPreview() {
  const fields = readForm();
  updateSummaryHint();
  renderThumb();
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
  updateSlugAuto();
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
      if (attempt > 1) state.autoNumber = randomNumber();
      fields.slug = autoSlugFor(fields);
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
    if (invalid.field === 'f-slug') setSlugError(invalid.message);
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
    server.slug = autoSlugFor(server);
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
  loadIndex();
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
      syncAutoSlug();
    }
    if (event.target.id === 'f-summary') updateSummaryCount();
    if (event.target.id === 'f-body') autosize();
    markDirty();
  });
  $('f-external').addEventListener('change', autofillExternal);
  $('f-category-new').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitNewCategory();
    }
  });
  $('f-category-new').addEventListener('blur', commitNewCategory);
  $('f-slug').addEventListener('input', () => {
    // 手で書き換えたら自動を止める。空にしたら自動に戻し、すぐ作り直す
    if (state.originalSlug === null) {
      state.slugAuto = $('f-slug').value === '';
      // 空に戻したら番号も振り直す
      if (state.slugAuto) state.autoNumber = null;
    }
    syncAutoSlug();
    updateSlugAuto();
    const slug = $('f-slug').value;
    const invalid = Boolean(slug) && !isValidSlug(slug);
    setSlugError(invalid ? 'slug は英小文字・数字・ハイフンのみ使えます。' : '');
  });

  for (const button of document.querySelectorAll('#kind-tabs button')) {
    button.addEventListener('click', () => {
      setKind(button.dataset.kind);
      syncAutoSlug();
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

  attachTagInput();
  attachToolbar({
    textarea: $('f-body'),
    toolbar: $('toolbar'),
    fileInput: $('f-image'),
    upload: uploadImage,
    onError: (message) => showNotice('error', message),
  });

  $('thumb-auto').addEventListener('click', () => {
    state.thumbImage = '';
    renderThumb();
    markDirty();
  });
  $('thumb-pick').addEventListener('click', () => {
    if ($('thumb-choices').hidden) showThumbChoices();
    else $('thumb-choices').hidden = true;
  });
  $('thumb-upload').addEventListener('click', () => $('thumb-file').click());
  $('thumb-file').addEventListener('change', async () => {
    const file = $('thumb-file').files[0];
    $('thumb-file').value = '';
    if (!file) return;
    showNotice('info', '画像をアップロードしています…');
    try {
      // 本文には挿入しない。URL だけを手動のサムネイルにする
      state.thumbImage = await uploadImage(file);
      renderThumb();
      markDirty();
    } catch (error) {
      showNotice('error', error.message);
    }
  });
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
