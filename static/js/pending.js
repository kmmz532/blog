// 公開・削除の直後に、反映待ちの内容をこの端末だけで先に見せる（design.md §12）。
// 控えは localStorage に置き、ビルド時刻を過ぎたら、または 30 分経ったら消す。GitHub API は呼ばない。
import { getToken } from './github.js';
import { getItem, setItem, removeItem, keys } from './storage.js';
import { renderPreview } from './preview.js';

const PREFIX = 'blog_pending:';
const EXPIRE_SECONDS = 30 * 60;
// editor.js と同じ marked。記事詳細では読み込まれていないので、必要になったときだけ読む
const MARKED_SRC = 'https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js';
const MARKED_SRI = 'sha384-H+hy9ULve6xfxRkWIh/YOtvDdpXgV2fmAGQkIDTxIgZwNoaoBal14Di2YTMR6MzR';

const nowSec = () => Math.floor(Date.now() / 1000);

// 公開成功時に editor.js から呼ぶ。isNew は一覧に新しいカードを出すかどうか
export function recordSave(slug, { fields, isNew, oldSlug = null }) {
  setItem(PREFIX + slug, JSON.stringify({ op: 'save', at: nowSec(), oldSlug, new: isNew, fields }));
}

// 削除成功時、または slug 変更で旧 slug が消えたときに呼ぶ
export function recordDelete(slug) {
  setItem(PREFIX + slug, JSON.stringify({ op: 'delete', at: nowSec() }));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// 装飾のアイコン（読み上げない）
function icon(className) {
  const node = el('i', className);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

// 壊れた控えや形の合わない控えは null
function parseControl(raw) {
  try {
    const control = JSON.parse(raw);
    if (typeof control?.at !== 'number') return null;
    if (control.op === 'delete') return control;
    return control.op === 'save' && control.fields ? control : null;
  } catch {
    return null;
  }
}

function controlFor(slug) {
  return parseControl(getItem(PREFIX + slug));
}

// 控えを公開時刻の古い順に並べる
function controlsByTime() {
  return keys()
    .filter((key) => key.startsWith(PREFIX))
    .map((key) => ({ slug: key.slice(PREFIX.length), control: parseControl(getItem(key)) }))
    .filter((item) => item.control)
    .sort((a, b) => a.control.at - b.control.at);
}

// ビルド時刻を過ぎた控え（反映済み）と、30 分経った控えを消す。30 分で消したものがあれば true
function sweep() {
  const built = Number(document.querySelector('meta[name="build-time"]')?.content);
  let expired = false;
  for (const key of keys().filter((k) => k.startsWith(PREFIX))) {
    const control = parseControl(getItem(key));
    if (!control) {
      removeItem(key);
    } else if (built > control.at) {
      removeItem(key);
    } else if (nowSec() - control.at > EXPIRE_SECONDS) {
      removeItem(key);
      expired = true;
    }
  }
  return expired;
}

function pendingBand(text = '反映待ち（この端末だけの表示）') {
  const band = el('p', 'pending-band');
  band.append(icon('fa-solid fa-clock'), ` ${text}`);
  return band;
}

function dateEl(date) {
  const time = el('time', '', date.slice(0, 10).replaceAll('-', '.'));
  time.dateTime = date;
  return time;
}

function loadMarked() {
  if (window.marked) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MARKED_SRC;
    script.integrity = MARKED_SRI;
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

// 記事詳細と同じ形で描画する（タイトル・日付・カテゴリ・タグ・本文）
async function renderArticle(container, fields) {
  try {
    await loadMarked();
  } catch {
    // 読めなければ renderPreview が「読み込めませんでした」を出す
  }
  renderPreview(fields.body, fields.title, container);
  const heading = container.querySelector('h1');
  const meta = el('div', 'post-meta');
  meta.append(dateEl(fields.date));
  if (fields.category) meta.append(el('span', 'chip', fields.category));
  const tags = el('div', 'card-tags');
  for (const tag of fields.tags ?? []) tags.append(el('span', 'chip', `#${tag}`));
  heading.after(meta, ...(tags.childElementCount ? [tags] : []));
  container.prepend(pendingBand());
}

function renderDeleted(container) {
  container.replaceChildren(pendingBand('この記事は削除済みです（反映待ち）'));
}

function renderCard(slug, fields) {
  const external = fields.kind === 'external';
  const article = el('article', 'carditem');
  if (fields.image) {
    article.classList.add('has-thumb');
    const thumb = el('img', 'card-thumb');
    thumb.src = fields.image;
    thumb.width = 96;
    thumb.height = 96;
    thumb.alt = '';
    thumb.loading = 'lazy';
    article.append(thumb);
  }
  const body = el('div', 'card-body');
  body.append(pendingBand());

  const meta = el('div', 'card-meta');
  meta.append(dateEl(fields.date));
  if (fields.category) meta.append(el('span', '', fields.category));

  const heading = el('h2', 'card-title');
  const link = el('a', '', fields.title || fields.url || '（無題）');
  link.href = external ? fields.url : `/posts/${slug}/`;
  if (external) {
    link.target = '_blank';
    link.rel = 'noopener';
  }
  heading.append(link);
  if (external) {
    const source = el('span', 'card-external');
    source.append(icon('fa-solid fa-arrow-up-right-from-square'), ` ${fields.source || ''}`);
    heading.append(source);
  }
  body.append(meta, heading);

  if (fields.summary) body.append(el('p', 'card-excerpt', fields.summary));
  if (fields.tags?.length) {
    const tags = el('div', 'card-tags');
    for (const tag of fields.tags) tags.append(el('span', 'chip', `#${tag}`));
    body.append(tags);
  }

  const edit = el('a', 'card-edit');
  edit.href = `/edit/?slug=${encodeURIComponent(slug)}`;
  edit.setAttribute('aria-label', '編集');
  edit.title = '編集';
  edit.append(icon('fa-solid fa-pen'));

  article.append(body, edit);
  return article;
}

// 一覧の中から slug のカードを探す（編集リンクの slug で判定）
function findCard(list, slug) {
  return (
    [...list.querySelectorAll('.carditem')].find((card) => {
      const href = card.querySelector('.card-edit')?.getAttribute('href') ?? '';
      return new URL(href, location.href).searchParams.get('slug') === slug;
    }) ?? null
  );
}

function applyToList(list) {
  for (const { slug, control } of controlsByTime()) {
    const card = findCard(list, slug);
    if (control.op === 'delete') {
      if (card) card.hidden = true;
    } else if (card) {
      card.replaceWith(renderCard(slug, control.fields));
    } else if (control.new) {
      list.prepend(renderCard(slug, control.fields));
    }
  }
}

// 一覧の 1 ページ目だけ（canonical が / のページ）。タグ・カテゴリ・2 ページ目以降は補わない
function isFirstPage() {
  const canonical = document.querySelector('link[rel="canonical"]')?.href;
  return Boolean(canonical) && new URL(canonical).pathname === '/';
}

function showStaleNotice() {
  const main = document.querySelector('main.contents');
  if (!main) return;
  main.prepend(
    el('p', 'pending-notice', '公開した記事が反映されていない可能性があります（Actions を確認してください）'),
  );
}

export function applyPending() {
  if (!getToken()) return;
  if (sweep()) showStaleNotice();

  const article = document.querySelector('article[data-slug]');
  if (article) {
    const control = controlFor(article.dataset.slug);
    if (control?.op === 'delete') renderDeleted(article);
    else if (control && control.fields.kind !== 'external') renderArticle(article, control.fields);
    return;
  }

  // 404 ページ（data-not-found）で、新規記事の URL を開いたとき
  const match = location.pathname.match(/^\/posts\/([a-z0-9-]+)\/?$/);
  if (match && document.querySelector('[data-not-found]')) {
    const control = controlFor(match[1]);
    if (control?.op === 'save' && control.fields.kind !== 'external') {
      renderArticle(document.querySelector('main.contents'), control.fields);
    }
    return;
  }

  const list = document.querySelector('.card-list');
  if (list && isFirstPage()) applyToList(list);
}
