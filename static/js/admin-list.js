// /admin/ の一覧・絞り込み・選択・一括操作（design.md §17）。
// 一覧は index.json（公開済みの記事）から作る。ユーザー由来の文字列は textContent で描画する。
import { ensureDevSession, getToken, getPost, commitChanges, ConflictError } from './github.js';
import { applyBulk } from './frontmatter.js';

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

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function row(item) {
  const tr = document.createElement('tr');

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = selected.has(item.slug);
  check.setAttribute('aria-label', `${item.title || item.slug} を選ぶ`);
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
  $('admin-all').checked = visible.length > 0 && visible.every((item) => selected.has(item.slug));
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
  $('bulk-category').replaceChildren(
    ...categoryPaths().map((path) => {
      const option = document.createElement('option');
      option.value = JSON.stringify(path);
      option.textContent = path.join(' / ');
      return option;
    }),
  );
}

// 選んだ操作の中身。入力に問題があれば文字列でエラーを返す
function bulkOptions(action) {
  if (action === 'category') {
    const value = $('bulk-category').value;
    if (!value) return '設定するカテゴリを選んでください。';
    return { categories: JSON.parse(value) };
  }
  if (action === 'addTags' || action === 'removeTags') {
    const tags = splitTags($('bulk-tags').value);
    if (!tags.length) return 'タグを入力してください。';
    return action === 'addTags' ? { addTags: tags } : { removeTags: tags };
  }
  return {};
}

const setStatus = (text) => {
  $('admin-status').textContent = text;
};

// 一括操作を実行する。確認 → 記事を読む → 変換 → 1 コミット。途中で失敗したら何も変えない
async function apply() {
  const action = $('bulk-action').value;
  const slugs = [...selected];
  if (!slugs.length) return;
  const options = bulkOptions(action);
  if (typeof options === 'string') {
    setStatus(options);
    return;
  }

  const count = slugs.length;
  if (action === 'delete') {
    const typed = prompt(`${count} 件の記事を削除します。確認のため件数「${count}」を入力してください。`);
    if (typed !== String(count)) {
      setStatus('削除を取り消しました。');
      return;
    }
  } else if (!confirm(`${count} 件に「${ACTION_LABELS[action]}」を行い、1 つのコミットにします。よろしいですか？`)) {
    setStatus('取り消しました。');
    return;
  }

  $('bulk-apply').disabled = true;
  setStatus('保存しています…');
  try {
    const changes = {};
    if (action === 'delete') {
      for (const slug of slugs) changes[slug] = null;
    } else {
      const posts = await Promise.all(slugs.map((slug) => getPost(slug)));
      slugs.forEach((slug, index) => {
        if (!posts[index]) throw new Error(`記事「${slug}」が見つかりません。何も変えていません。`);
        changes[slug] = applyBulk(posts[index].text, options);
      });
    }
    await commitChanges(changes, `一括操作: ${ACTION_LABELS[action]} ${count} 件`);

    // 一覧も変更後の内容に合わせる（index.json は次の反映で更新される）
    if (action === 'delete') {
      articles = articles.filter((item) => !slugs.includes(item.slug));
    } else {
      for (const item of articles) {
        if (!slugs.includes(item.slug)) continue;
        if (options.categories) item.categories = options.categories;
        if (options.addTags) item.tags = [...new Set([...(item.tags ?? []), ...options.addTags])];
        if (options.removeTags) item.tags = (item.tags ?? []).filter((tag) => !options.removeTags.includes(tag));
      }
    }
    selected.clear();
    fillCategoryOptions();
    renderRows();
    setStatus(`${count} 件を保存しました。1〜2 分後に反映されます。`);
  } catch (error) {
    setStatus(
      error instanceof ConflictError
        ? '他で更新されています。再読み込みしてからもう一度行ってください（何も変えていません）。'
        : error.message,
    );
  } finally {
    $('bulk-apply').disabled = selected.size === 0;
  }
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
  $('bulk-apply').addEventListener('click', apply);
}

async function load() {
  const indexUrl = document.querySelector('script[data-index-url]').dataset.indexUrl;
  const res = await fetch(indexUrl, { cache: 'no-store' });
  if (!res.ok) {
    setStatus('記事の一覧を読み込めませんでした。');
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
