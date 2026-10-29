import { getPost, savePost, deletePost, getToken, isValidSlug, ConflictError } from './github.js';
import { uploadImage } from './image.js';
import { parseArticle, buildArticle } from './frontmatter.js';
import { draftKey, hasDraft, readDraft, writeDraft, removeDraft, renderDrafts } from './drafts.js';
import { renderPreview } from './preview.js';
import { nowJst } from './time.js';

const $ = (id) => document.getElementById(id);

// originalSlug: 保存済み記事の slug。新規は null
const state = { originalSlug: null, sha: null, aliases: [], extra: [] };
let dirty = false;

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

function readForm() {
  return {
    slug: $('f-slug').value.trim(),
    title: $('f-title').value.trim(),
    date: $('f-date').value.slice(0, 16),
    category: $('f-category').value,
    tags: $('f-tags').value.split(',').map((tag) => tag.trim()).filter(Boolean),
    summary: $('f-summary').value.trim(),
    body: $('f-body').value,
  };
}

function writeForm(fields) {
  $('f-slug').value = fields.slug;
  $('f-title').value = fields.title;
  $('f-date').value = fields.date;
  const select = $('f-category');
  if (![...select.options].some((option) => option.value === fields.category)) {
    select.add(new Option(fields.category, fields.category));
  }
  select.value = fields.category;
  $('f-tags').value = fields.tags.join(', ');
  $('f-summary').value = fields.summary;
  $('f-body').value = fields.body;
}

function validate(fields) {
  if (!isValidSlug(fields.slug)) {
    return 'slug は英小文字・数字・ハイフンのみ（1〜80 文字）で入力してください。';
  }
  if (!fields.title) return 'タイトルを入力してください。';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fields.date)) return '投稿日時を入力してください。';
  return null;
}

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
  }
  renderDrafts($('drafts'));
}

function updateChrome() {
  const saved = state.originalSlug !== null;
  $('edit-title').textContent = saved ? '記事の編集' : '新規記事';
  $('delete').hidden = !saved;
  const view = $('view-link');
  view.hidden = !saved;
  if (saved) view.href = `/posts/${state.originalSlug}/`;
}

function failStart(message) {
  setStatus(message, true);
  $('save').disabled = true;
  $('delete').hidden = true;
}

// slug 変更: 新 slug を作ってから旧ファイルを消す。旧ファイルの削除に失敗したら警告を返す
async function renameSlug(fields) {
  const oldSlug = state.originalSlug;
  const oldSha = state.sha;
  const aliases = [...new Set([...state.aliases, `/posts/${oldSlug}/`])];

  // sha を付けない。同名があれば ConflictError で中止される
  const sha = await savePost(fields.slug, buildArticle(fields, aliases, state.extra));
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
  setStatus('保存しています…');
  try {
    let warning = null;
    if (slugChanged) {
      warning = await renameSlug(fields);
    } else {
      state.sha = await savePost(
        fields.slug,
        buildArticle(fields, state.aliases, state.extra),
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
    parsed.fields.slug = slug;
    state.originalSlug = slug;
    state.sha = post.sha;
    state.aliases = parsed.aliases;
    state.extra = parsed.extra;
    server = parsed.fields;
  } else {
    server = { slug: '', title: '', date: nowJst(), category: 'tech', tags: [], summary: '', body: '' };
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
  renderPreview($('f-body').value, $('preview'));
  renderDrafts($('drafts'));
}

// 画像を保存し、カーソル位置に Markdown を挿入する
async function insertImage(event) {
  const input = event.target;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  const body = $('f-body');
  const start = body.selectionStart;
  const end = body.selectionEnd;
  const alt = file.name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '');

  input.disabled = true;
  setStatus('画像を保存しています…');
  try {
    const url = await uploadImage(file);
    const snippet = `![${alt}](${url})`;
    body.value = body.value.slice(0, start) + snippet + body.value.slice(end);
    body.setSelectionRange(start + snippet.length, start + snippet.length);
    // input イベントを出して下書き保存とプレビューを更新する
    body.dispatchEvent(new Event('input', { bubbles: true }));
    setStatus('画像を保存しました。公開するまで反映されません。反映には 1〜2 分かかります。');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    input.disabled = false;
  }
}

function start() {
  const form = $('post-form');
  const scheduleDraft = debounce(saveDraft, 1000);
  const schedulePreview = debounce(() => renderPreview($('f-body').value, $('preview')), 300);

  form.addEventListener('submit', publish);
  form.addEventListener('input', () => {
    dirty = true;
    scheduleDraft();
    schedulePreview();
  });
  $('f-image').addEventListener('change', insertImage);
  $('delete').addEventListener('click', removePost);
  $('discard').addEventListener('click', () => {
    if (!confirm('この記事の下書きを破棄して、保存済みの内容を読み直します。')) return;
    removeDraft(draftKey(state.originalSlug));
    dirty = false;
    location.reload();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  load();
}

if (getToken()) {
  start();
} else {
  location.replace(`/login/?return=${encodeURIComponent(location.pathname + location.search)}`);
}
