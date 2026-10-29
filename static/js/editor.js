import { getPost, savePost, deletePost, getToken, isValidSlug, ConflictError } from './github.js';
import { uploadImage } from './image.js';
import { parseArticle, buildArticle, buildExternal } from './frontmatter.js';
import { draftKey, hasDraft, readDraft, writeDraft, removeDraft, renderDrafts } from './drafts.js';
import { renderPreview } from './preview.js';
import { attachToolbar } from './toolbar.js';
import { fetchExternalMeta } from './external.js';
import { nowJst } from './time.js';

const $ = (id) => document.getElementById(id);
const SUMMARY_TARGET = 120;
const SOURCE_NAMES = { 'zenn.dev': 'Zenn', 'qiita.com': 'Qiita', 'note.com': 'note' };

// originalSlug: 保存済み記事の slug。新規は null。kind: 'article' | 'external'
const state = { kind: 'article', originalSlug: null, sha: null, aliases: [], extra: [] };
let tags = [];
let dirty = false;
let autoSource = '';
// 利用者が日時を触ったら、外部ページからの自動入力で上書きしない
let dateTouched = false;

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function setStatus(message, isError = false) {
  const el = $('status');
  el.textContent = message;
  el.classList.toggle('error', isError);
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
  dirty = true;
  setStatus('未保存の変更があります');
  scheduleDraft();
  scheduleRefresh();
}

function currentCategory() {
  return document.querySelector('input[name="f-category"]:checked')?.value ?? 'tech';
}

function readForm() {
  return {
    kind: state.kind,
    slug: $('f-slug').value.trim(),
    title: $('f-title').value.trim(),
    date: $('f-date').value.slice(0, 16),
    category: currentCategory(),
    tags: [...tags],
    summary: $('f-summary').value.trim(),
    body: $('f-body').value,
    url: $('f-external').value.trim(),
    source: $('f-source').value.trim(),
  };
}

function writeForm(fields) {
  setKind(fields.kind ?? 'article');
  $('f-slug').value = fields.slug;
  $('f-title').value = fields.title;
  $('f-date').value = fields.date;
  for (const radio of document.querySelectorAll('input[name="f-category"]')) {
    radio.checked = radio.value === fields.category;
  }
  tags = [...fields.tags];
  renderTags();
  $('f-summary').value = fields.summary;
  $('f-body').value = fields.body;
  $('f-external').value = fields.url ?? '';
  $('f-source').value = fields.source ?? '';
  updateSummaryCount();
  autosize();
}

function validate(fields) {
  if (!isValidSlug(fields.slug)) {
    return 'slug は英小文字・数字・ハイフンのみ（1〜80 文字）で入力してください。';
  }
  // 外部記事のタイトルと概要は空でもよい（ビルド時に OGP で補う）
  if (fields.kind !== 'external' && !fields.title) return 'タイトルを入力してください。';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fields.date)) return '投稿日時を入力してください。';
  if (fields.kind === 'external') {
    if (!isHttps(fields.url)) return '外部記事の URL は https:// で始まるものを入れてください。';
    if (!fields.source) return 'サイト名を入力してください。';
  }
  return null;
}

function isHttps(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

// 種類は保存後に変えられないので、既存記事ではタブを隠す
function setKind(kind) {
  state.kind = kind;
  const external = kind === 'external';
  $('editor-main').dataset.kind = external ? 'external' : 'article';
  $('external-fields').hidden = !external;
  $('toolbar').hidden = external;
  $('f-body').hidden = external;
  $('view-edit').hidden = external;
  $('view-preview').hidden = external;
  $('view-split').hidden = external || !window.matchMedia('(min-width: 1400px)').matches;
  for (const button of document.querySelectorAll('#kind-tabs button')) {
    button.setAttribute('aria-pressed', String(button.dataset.kind === kind));
  }
  setView(external ? 'preview' : 'edit');
}

function setView(view) {
  $('editor-main').dataset.view = view;
  $('editor-main').classList.toggle('split', view === 'split');
  $('view-edit').setAttribute('aria-pressed', String(view === 'edit'));
  $('view-preview').setAttribute('aria-pressed', String(view === 'preview'));
  $('view-split').setAttribute('aria-pressed', String(view === 'split'));
  refreshPreview();
}

// ---- タグ（チップ入力） ----

function renderTags() {
  const box = $('tag-input');
  for (const chip of box.querySelectorAll('.chip')) chip.remove();
  tags.forEach((tag, index) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = tag;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `${tag} を削除`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      tags.splice(index, 1);
      renderTags();
      markDirty();
    });
    chip.append(remove);
    box.insertBefore(chip, $('f-tag-entry'));
  });
}

function addTag(raw) {
  const tag = raw.trim().replace(/^#/, '');
  if (!tag || tags.includes(tag)) return;
  tags.push(tag);
  renderTags();
  markDirty();
}

function attachTagInput() {
  const entry = $('f-tag-entry');
  entry.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag(entry.value);
      entry.value = '';
    } else if (event.key === 'Backspace' && entry.value === '' && tags.length) {
      tags.pop();
      renderTags();
      markDirty();
    }
  });
  entry.addEventListener('blur', () => {
    addTag(entry.value);
    entry.value = '';
  });
  $('tag-input').addEventListener('click', () => entry.focus());
}

async function loadTagSuggestions() {
  try {
    const res = await fetch($('post-form').dataset.indexUrl, { cache: 'no-store' });
    if (!res.ok) return;
    const known = new Set((await res.json()).flatMap((post) => post.tags ?? []));
    $('tag-list').replaceChildren(...[...known].sort().map((tag) => new Option(tag)));
  } catch {
    // 候補が出なくても入力は続けられる
  }
}

// ---- 概要・本文の高さ・外部記事 ----

function updateSummaryCount() {
  const length = [...$('f-summary').value].length;
  const count = $('summary-count');
  count.textContent = `${length} / ${SUMMARY_TARGET}`;
  count.classList.toggle('warn', length > SUMMARY_TARGET);
}

function autosize() {
  const body = $('f-body');
  body.style.height = 'auto';
  body.style.height = `${body.scrollHeight}px`;
}

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
  if (guess && (source.value === '' || source.value === autoSource)) {
    source.value = guess;
    autoSource = guess;
  }
}

// URL の確定時に外部ページから項目を取る。入力済みの項目は上書きしない
async function autofillExternal() {
  const url = $('f-external').value.trim();
  if (!isHttps(url)) return;
  setStatus('外部ページから項目を取得しています…');
  const meta = await fetchExternalMeta(url);
  if (!meta) {
    setStatus('自動取得できませんでした（手入力してください）。');
    return;
  }

  if (!$('f-title').value && meta.title) $('f-title').value = meta.title;
  if (!$('f-summary').value && meta.summary) {
    $('f-summary').value = meta.summary;
    updateSummaryCount();
  }
  if (!tags.length && meta.tags.length) {
    tags = meta.tags.filter(Boolean);
    renderTags();
  }
  if (!dateTouched && meta.date) $('f-date').value = meta.date;
  const source = $('f-source');
  if (meta.source && (source.value === '' || source.value === autoSource)) {
    source.value = meta.source;
    autoSource = meta.source;
  }
  markDirty();
  setStatus('外部ページから項目を取得しました。内容を確認してください。');
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
  heading.textContent = fields.title || '（無題）';

  const source = document.createElement('p');
  source.className = 'card-external';
  source.textContent = fields.source || '';

  article.append(meta, heading, source);
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
  if (fields.kind === 'external') renderExternalCard(fields);
  else renderPreview(fields.body, fields.title, $('preview'));
}

// ---- 下書き ----

function saveDraft() {
  const payload = {
    ...readForm(),
    sha: state.sha,
    aliases: state.aliases,
    extra: state.extra,
    savedAt: new Date().toISOString(),
  };
  if (!writeDraft(draftKey(state.originalSlug), payload)) {
    setStatus('下書きを保存できませんでした。', true);
  } else {
    const time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    setStatus(`下書きを保存しました ${time}`);
  }
  renderDrafts($('drafts'));
}

// ---- 画面状態 ----

function updateChrome() {
  const saved = state.originalSlug !== null;
  $('kind-tabs').hidden = saved;
  $('danger-details').hidden = !saved;
  const back = $('back-link');
  back.href = saved && state.kind === 'article' ? `/posts/${state.originalSlug}/` : '/';
}

function failStart(message) {
  setStatus(message, true);
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

async function publish(event) {
  event.preventDefault();
  const fields = readForm();
  const invalid = validate(fields);
  if (invalid) {
    setStatus(invalid, true);
    return;
  }

  const creating = state.originalSlug === null;
  const slugChanged = !creating && fields.slug !== state.originalSlug;
  const oldKey = draftKey(state.originalSlug);

  $('save').disabled = true;
  setStatus('公開しています…');
  try {
    let warning = null;
    if (slugChanged) {
      warning = await renameSlug(fields);
    } else {
      state.sha = await savePost(
        fields.slug,
        serialize(fields, state.aliases),
        creating ? undefined : state.sha,
      );
    }

    state.originalSlug = fields.slug;
    removeDraft(oldKey);
    dirty = false;
    history.replaceState(null, '', `/edit/?slug=${encodeURIComponent(fields.slug)}`);
    updateChrome();
    renderDrafts($('drafts'));

    if (warning) {
      setStatus(warning, true);
    } else {
      setStatus('公開しました。1〜2分後に反映されます。');
    }
  } catch (error) {
    setStatus(errorMessage(error, creating || slugChanged), true);
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
    setStatus('slug が一致しないため削除しませんでした。', true);
    return;
  }

  $('delete').disabled = true;
  try {
    await deletePost(slug, state.sha);
    removeDraft(draftKey(slug));
    dirty = false;
    location.assign('/');
  } catch (error) {
    setStatus(errorMessage(error, false), true);
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
  }

  writeForm(server);

  const key = draftKey(state.originalSlug);
  if (hasDraft(key)) {
    const draft = readDraft(key);
    // キャンセルか壊れた下書きは捨てる
    if (draft && confirm('この記事の下書きがあります。復元しますか？\n「キャンセル」を選ぶと下書きを削除します。')) {
      writeForm(draft);
      state.sha = draft.sha ?? null;
      state.aliases = draft.aliases ?? [];
      state.extra = draft.extra ?? [];
      dirty = true;
      setStatus('下書きを復元しました。');
    } else {
      removeDraft(key);
    }
  }

  updateChrome();
  refreshPreview();
  renderDrafts($('drafts'));
  loadTagSuggestions();
}

function start() {
  const form = $('post-form');
  scheduleDraft = debounce(saveDraft, 1000);
  scheduleRefresh = debounce(refreshPreview, 300);

  form.addEventListener('submit', publish);
  form.addEventListener('input', (event) => {
    if (event.target.id === 'f-external') onExternalUrlInput();
    if (event.target.id === 'f-date') dateTouched = true;
    if (event.target.id === 'f-summary') updateSummaryCount();
    if (event.target.id === 'f-body') autosize();
    markDirty();
  });
  $('f-external').addEventListener('change', autofillExternal);
  $('f-slug').addEventListener('input', () => {
    const slug = $('f-slug').value;
    if (slug && !isValidSlug(slug)) setStatus('slug は英小文字・数字・ハイフンのみ使えます。', true);
  });

  for (const button of document.querySelectorAll('#kind-tabs button')) {
    button.addEventListener('click', () => {
      if (button.dataset.kind === 'external' && $('f-slug').value === '') $('f-slug').value = 'ext-';
      setKind(button.dataset.kind);
      markDirty();
    });
  }
  $('view-edit').addEventListener('click', () => setView('edit'));
  $('view-preview').addEventListener('click', () => setView('preview'));
  $('view-split').addEventListener('click', () => setView('split'));

  attachTagInput();
  attachToolbar({
    textarea: $('f-body'),
    toolbar: $('toolbar'),
    fileInput: $('f-image'),
    upload: uploadImage,
    onError: (message) => setStatus(message, true),
  });

  $('delete').addEventListener('click', removePost);
  $('discard').addEventListener('click', () => {
    if (!confirm('この記事の下書きを破棄して、保存済みの内容を読み直します。')) return;
    removeDraft(draftKey(state.originalSlug));
    dirty = false;
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
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  load();
}

// start() の中で差し替える。markDirty から呼べるよう先に宣言しておく
let scheduleRefresh = () => {};
let scheduleDraft = () => {};

if (getToken()) {
  start();
} else {
  location.replace(`/login/?return=${encodeURIComponent(location.pathname + location.search)}`);
}
