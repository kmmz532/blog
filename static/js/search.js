// 検索結果の描画は textContent のみ使う（記事本文を innerHTML に入れない）。
const input = document.getElementById('q');
const results = document.getElementById('search-results');
const count = document.getElementById('search-count');
const indexUrl = results.dataset.indexUrl;

let posts = [];
let loadError = false;

function matches(post, words) {
  const haystack = [post.title, post.summary, ...(post.tags ?? []), post.body ?? '']
    .join('\n')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

function card(post) {
  const article = document.createElement('article');
  article.className = 'carditem';

  const title = document.createElement('h2');
  title.className = 'card-title';
  const link = document.createElement('a');
  link.href = post.url;
  link.textContent = post.title;
  title.append(link);

  const meta = document.createElement('p');
  meta.className = 'card-meta';
  meta.textContent = post.date;
  for (const category of post.categories ?? []) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = category;
    meta.append(' ', chip);
  }

  article.append(title, meta);
  if (post.summary) {
    const excerpt = document.createElement('p');
    excerpt.className = 'card-excerpt';
    excerpt.textContent = post.summary;
    article.append(excerpt);
  }
  return article;
}

function render() {
  const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const params = new URLSearchParams(location.search);
  if (input.value.trim()) params.set('q', input.value.trim());
  else params.delete('q');
  const query = params.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);

  results.replaceChildren();
  if (loadError) {
    count.textContent = '検索インデックスを読み込めませんでした。';
    return;
  }
  if (words.length === 0) {
    count.textContent = '';
    return;
  }
  const hits = posts.filter((post) => matches(post, words));
  count.textContent = `${hits.length} 件`;
  results.replaceChildren(...hits.map(card));
}

input.addEventListener('input', render);
document.getElementById('search-form').addEventListener('submit', (event) => event.preventDefault());

input.value = new URLSearchParams(location.search).get('q') ?? '';

try {
  const res = await fetch(indexUrl);
  if (!res.ok) throw new Error(String(res.status));
  posts = await res.json();
} catch {
  loadError = true;
}
render();
