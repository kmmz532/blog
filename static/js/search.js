// 検索結果の描画は textContent のみ使う（記事本文を innerHTML に入れない）。
const input = document.getElementById('q');
const results = document.getElementById('search-results');
const count = document.getElementById('search-count');
const indexUrl = results.dataset.indexUrl;
// トップページでは、検索中だけ記事の一覧とページ送りを隠して結果を出す（検索ページには無い）
const homeList = document.getElementById('home-list');

let posts = [];
let loadError = false;

// 大文字小文字・全角半角（NFKC）・カタカナとひらがなの違いを無視して比べる
function normalize(text) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function matches(post, words) {
  post.haystack ??= normalize([post.title, post.summary, ...(post.tags ?? []), post.body ?? ''].join('\n'));
  return words.every((word) => post.haystack.includes(word));
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
  meta.textContent = post.date.replaceAll('-', '.');
  for (const category of post.categories ?? []) {
    const label = document.createElement('span');
    label.textContent = category;
    meta.append(label);
  }

  article.append(title, meta);
  if (post.summary) {
    const excerpt = document.createElement('p');
    excerpt.className = 'card-excerpt';
    excerpt.textContent = post.summary;
    article.append(excerpt);
  }
  if (post.tags?.length) {
    const tagBox = document.createElement('div');
    tagBox.className = 'card-tags';
    for (const tag of post.tags) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `#${tag}`;
      tagBox.append(chip);
    }
    article.append(tagBox);
  }
  return article;
}

function render() {
  const words = normalize(input.value.trim()).split(/\s+/).filter(Boolean);
  const params = new URLSearchParams(location.search);
  if (input.value.trim()) params.set('q', input.value.trim());
  else params.delete('q');
  const query = params.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);

  results.replaceChildren();
  if (homeList) homeList.hidden = words.length > 0 && !loadError;
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
  // 結果が入れ替わるたびに、ページを開いたときと同じ出現の動きをやり直す
  results.style.animation = 'none';
  void results.offsetWidth;
  results.style.animation = '';
}

// 本文まで入った索引は大きいので、トップページでは検索を始めるまで読まない
let loading = null;
function loadIndex() {
  loading ??= fetch(indexUrl)
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    })
    .then((json) => {
      posts = json;
    })
    .catch(() => {
      loadError = true;
    });
  return loading;
}

// 入力が止まってから検索する（1 文字ごとに全記事を調べ直さない）
const DEBOUNCE_MS = 200;
let timer = 0;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await loadIndex();
    render();
  }, DEBOUNCE_MS);
});
document.getElementById('search-form').addEventListener('submit', (event) => event.preventDefault());

input.value = new URLSearchParams(location.search).get('q') ?? '';

if (!homeList || input.value.trim()) await loadIndex();
render();
