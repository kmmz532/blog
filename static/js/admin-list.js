// /admin/ の一覧・絞り込み・選択・一括操作の選び方（design.md §17）。
// 一覧は index.json（公開済みの記事）から作る。ユーザー由来の文字列は textContent で描画する。
import { ensureDevSession, getToken } from './github.js';

const $ = (id) => document.getElementById(id);
const ACTION_LABELS = {
  delete: '削除',
  category: 'カテゴリを設定',
  addTags: 'タグを追加',
  removeTags: 'タグを削除',
};

let articles = [];
// 選んでいる記事の slug。絞り込みで隠れても選択は残す
const selected = new Set();

const splitTags = (text) =>
  text
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean);

function visibleArticles() {
  const needle = $('admin-search').value.trim().toLowerCase();
  const kind = $('admin-kind').value;
  return articles.filter((item) => {
    if (kind === 'article' && item.external) return false;
    if (kind === 'external' && !item.external) return false;
    return !needle || item.title.toLowerCase().includes(needle);
  });
}

function cell(text, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

function row(item) {
  const tr = document.createElement('tr');

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = selected.has(item.slug);
  check.setAttribute('aria-label', `${item.title} を選ぶ`);
  check.addEventListener('change', () => {
    if (check.checked) selected.add(item.slug);
    else selected.delete(item.slug);
    updateBar();
  });
  const checkCell = document.createElement('td');
  checkCell.append(check);

  const title = document.createElement('a');
  title.href = `/edit/?slug=${encodeURIComponent(item.slug)}`;
  title.textContent = item.title || item.url || '（無題）';
  const titleCell = document.createElement('td');
  titleCell.append(title);

  tr.append(
    checkCell,
    cell(item.date.replaceAll('-', '.')),
    titleCell,
    cell(item.external ? '外部記事' : '記事'),
    cell((item.categories ?? []).join(' / ')),
    cell((item.tags ?? []).map((tag) => `#${tag}`).join(' ')),
  );
  return tr;
}

function renderRows() {
  const visible = visibleArticles();
  $('admin-rows').replaceChildren(...visible.map(row));
  $('admin-count').textContent = `${visible.length} 件（全 ${articles.length} 件）`;
  const all = $('admin-all');
  all.checked = visible.length > 0 && visible.every((item) => selected.has(item.slug));
  updateBar();
}

// 選んだ記事の数と、選んだ操作の入力欄
function updateBar() {
  const action = $('bulk-action').value;
  $('bulk-category').hidden = action !== 'category';
  $('bulk-tags').hidden = action !== 'addTags' && action !== 'removeTags';
  $('bulk-count').textContent = `${selected.size} 件を選択中`;
  $('bulk-apply').disabled = selected.size === 0;
  $('bulk-bar').hidden = selected.size === 0;
}

// 設定できるカテゴリの階層を、すべての記事から集める（段の重複は除く）
function categoryPaths() {
  const seen = new Map();
  for (const item of articles) {
    for (let k = 1; k <= (item.categories ?? []).length; k++) {
      const path = item.categories.slice(0, k);
      seen.set(JSON.stringify(path), path);
    }
  }
  return [...seen.values()].sort((a, b) => a.join('/').localeCompare(b.join('/')));
}

function fillCategoryOptions() {
  const select = $('bulk-category');
  select.replaceChildren(
    ...categoryPaths().map((path) => {
      const option = document.createElement('option');
      option.value = JSON.stringify(path);
      option.textContent = path.join(' / ');
      return option;
    }),
  );
}

// 押すと一括操作の内容を確かめるだけ（実行は T47）
function describeBulk() {
  const action = $('bulk-action').value;
  const count = selected.size;
  let detail = '';
  if (action === 'category') detail = `カテゴリを「${$('bulk-category').selectedOptions[0]?.textContent ?? ''}」にする`;
  if (action === 'addTags') detail = `タグ ${splitTags($('bulk-tags').value).join(', ')} を追加する`;
  if (action === 'removeTags') detail = `タグ ${splitTags($('bulk-tags').value).join(', ')} を外す`;
  $('bulk-status').textContent = `${count} 件を対象に「${ACTION_LABELS[action]}」${detail ? `（${detail}）` : ''}。`;
}

function attach() {
  $('admin-search').addEventListener('input', renderRows);
  $('admin-kind').addEventListener('change', renderRows);
  $('admin-all').addEventListener('change', () => {
    for (const item of visibleArticles()) {
      if ($('admin-all').checked) selected.add(item.slug);
      else selected.delete(item.slug);
    }
    renderRows();
  });
  $('bulk-action').addEventListener('change', updateBar);
  $('bulk-apply').addEventListener('click', describeBulk);
}

async function load() {
  const indexUrl = document.querySelector('script[data-index-url]').dataset.indexUrl;
  const res = await fetch(indexUrl, { cache: 'no-store' });
  if (!res.ok) {
    $('admin-status').textContent = '記事の一覧を読み込めませんでした。';
    return;
  }
  articles = (await res.json()).sort((a, b) => b.date.localeCompare(a.date));
  fillCategoryOptions();
  renderRows();
}

await ensureDevSession();
if (getToken()) {
  attach();
  load();
} else {
  location.replace(`/login/?return=${encodeURIComponent(location.pathname + location.search)}`);
}
