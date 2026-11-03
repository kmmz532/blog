// 検索結果の描画は textContent のみ使う（記事本文を innerHTML に入れない）。
const input = document.getElementById('q');
const results = document.getElementById('search-results');
const count = document.getElementById('search-count');
const indexUrl = results.dataset.indexUrl;
// トップページでは、検索中だけ記事の一覧とページ送りを隠して結果を出す（検索ページには無い）
const homeList = document.getElementById('home-list');

// 索引は 1 ファイルずつ読む（next をたどる。）。読んだ分は覚えておく
let posts = [];
const seen = new Set();
let nextUrl = indexUrl;
let total = null;
let loadError = false;
let reading = null;

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

// 読み終わるまでは「読み込み中（n / total）」を出す。読み終わっていれば件数だけ
function countText(hits) {
  if (loadError) return `${hits.length} 件（一部の検索インデックスを読み込めませんでした）`;
  if (nextUrl === null) return `${hits.length} 件`;
  return `${hits.length} 件（読み込み中 ${posts.length} / ${total ?? '?'}）`;
}

function render() {
  const words = normalize(input.value.trim()).split(/\s+/).filter(Boolean);
  const params = new URLSearchParams(location.search);
  if (input.value.trim()) params.set('q', input.value.trim());
  else params.delete('q');
  const query = params.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);

  results.replaceChildren();
  if (homeList) homeList.hidden = words.length > 0;
  if (loadError && posts.length === 0) {
    count.textContent = '検索インデックスを読み込めませんでした。';
    return;
  }
  if (words.length === 0) {
    count.textContent = '';
    return;
  }
  const hits = posts.filter((post) => matches(post, words));
  count.textContent = countText(hits);
  results.replaceChildren(...hits.map(card));
  // 結果が入れ替わるたびに、ページを開いたときと同じ出現の動きをやり直す
  results.style.animation = 'none';
  void results.offsetWidth;
  results.style.animation = '';
}

// 1 ファイルずつ読み足す。読み終わるまで 1 本だけ走らせ、検索語が変わっても止めない（読んだ分は次の検索でも使う）
function readIndex() {
  reading ??= (async () => {
    try {
      while (nextUrl) {
        const res = await fetch(nextUrl);
        if (!res.ok) throw new Error(String(res.status));
        const page = await res.json();
        for (const post of page.items) {
          if (seen.has(post.slug)) continue;
          seen.add(post.slug);
          posts.push(post);
        }
        total = page.total;
        nextUrl = page.next;
        render();
      }
    } catch {
      loadError = true;
      nextUrl = null;
      render();
    }
  })();
  return reading;
}

// 入力が止まってから検索する（1 文字ごとに全記事を調べ直さない）
const DEBOUNCE_MS = 200;
let timer = 0;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    readIndex();
    render();
  }, DEBOUNCE_MS);
});
document.getElementById('search-form').addEventListener('submit', (event) => event.preventDefault());

input.value = new URLSearchParams(location.search).get('q') ?? '';

// トップページでは検索を始めるまで読まない
if (!homeList || input.value.trim()) readIndex();
render();
