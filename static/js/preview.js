import { addCopyButtons } from './copy.js';

// marked の出力は HTML として挿入するため、危険な要素と属性を落としてから描画する。
// 記事詳細（single.html）と同じ見た目になるよう、タイトルと本文を同じクラスで出す。
// title が null のときはタイトルを出さない（編集画面は本文欄の上にタイトル入力があるため）。
const DROP = 'script, iframe, object, embed, style, link, meta, base, form';
// 本文の記法（design.md §18）。コードブロックの外だけ変換する。行の途中にあっても変換する
const SHORTCODE_LINE = /\{\{<\s*(link-card|tweet|youtube)\s+(?:url|id)="([^"]+)"\s*>\}\}/g;
const TWEET_URL = /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/\d+/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
// ビルド時に取った OGP（/ogp/index.json、design.md §18）。読めたら一度だけ読み、以後は同じ Promise を使う
let ogpIndex = null;

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function withSlots(markdown) {
  // split の奇数番目は ``` で囲まれた部分なので、そのまま残す
  return markdown
    .split(/(```[\s\S]*?```)/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(
            SHORTCODE_LINE,
            (_, name, value) => `<span class="shortcode-slot" data-name="${name}" data-value="${encodeURIComponent(value)}"></span>`,
          ),
    )
    .join('');
}

// URL → { title, desc, image } の Map。読めなければ空の Map（仮の見た目で出す）
function loadOgpIndex() {
  if (!ogpIndex) {
    ogpIndex = fetch(new URL('/ogp/index.json', location.origin))
      .then((res) => (res.ok ? res.json() : []))
      .catch(() => [])
      .then((items) => new Map(items.map((item) => [item.url, item])));
  }
  return ogpIndex;
}

// 取得した値は textContent と属性にだけ入れる（HTML として描画しない）
function makeElement(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function buildCard(url, card) {
  const link = makeElement('a', 'link-card');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  const body = makeElement('span', 'link-card-body');
  body.append(makeElement('span', 'link-card-title', card.title));
  if (card.desc) body.append(makeElement('span', 'link-card-desc', card.desc));
  body.append(makeElement('span', 'link-card-host', new URL(url).host));
  link.append(body);
  if (card.image && isHttpUrl(card.image)) {
    const img = makeElement('img', 'link-card-thumb');
    img.src = card.image;
    img.width = 96;
    img.height = 96;
    img.alt = '';
    img.loading = 'lazy';
    // 壊れた画像は出さない（公開後の表示と同じ）
    img.addEventListener('error', () => img.remove());
    link.append(img);
  }
  return link;
}

// 通常のリンク（http・https だけリンクにする）
function plainLink(url) {
  if (!isHttpUrl(url)) return makeElement('span', '', url);
  const link = makeElement('a', '', url);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
}

// 最初は通常のリンクを出し、ビルド時の OGP があればカードに差し替える。無い URL は仮の見た目（公開後に OGP で表示）
function fillLinkCard(slot, url) {
  slot.replaceChildren(plainLink(url));
  if (!isHttpUrl(url)) return;
  loadOgpIndex().then((map) => {
    const card = map.get(url);
    if (card?.title) slot.replaceChildren(buildCard(url, card));
    else slot.replaceChildren(buildCard(url, { title: url, desc: '公開すると OGP から表示されます', image: '' }));
  });
}

// X の公式の埋め込み（widgets.js、design.md §18）。読み込めなければ blockquote の中のリンクが残る
let twitterScript = null;

function loadTwitterWidget(slot) {
  if (window.twttr?.widgets) {
    window.twttr.widgets.load(slot);
    return;
  }
  if (!twitterScript) {
    twitterScript = document.createElement('script');
    twitterScript.src = 'https://platform.twitter.com/widgets.js';
    twitterScript.async = true;
    twitterScript.charset = 'utf-8';
    document.head.append(twitterScript);
  }
  twitterScript.addEventListener('load', () => window.twttr?.widgets.load(slot), { once: true });
}

function fillTweet(slot, url) {
  if (!TWEET_URL.test(url)) {
    slot.replaceChildren(plainLink(url));
    return;
  }
  const quote = makeElement('blockquote', 'twitter-tweet');
  quote.append(plainLink(url));
  slot.replaceChildren(quote);
  loadTwitterWidget(slot);
}

function fillYoutube(slot, id) {
  if (!YOUTUBE_ID.test(id)) {
    slot.replaceChildren(makeElement('span', 'shortcode-error', `YouTube の ID が正しくありません: ${id}`));
    return;
  }
  const frame = document.createElement('iframe');
  frame.src = `https://www.youtube-nocookie.com/embed/${id}`;
  frame.title = 'YouTube の動画';
  frame.loading = 'lazy';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.allowFullscreen = true;
  const wrap = makeElement('div', 'video-embed');
  wrap.append(frame);
  slot.replaceChildren(wrap);
}

function fillSlot(slot) {
  const value = decodeURIComponent(slot.dataset.value);
  if (slot.dataset.name === 'youtube') fillYoutube(slot, value);
  else if (slot.dataset.name === 'tweet') fillTweet(slot, value);
  else fillLinkCard(slot, value);
}

export function renderPreview(markdown, title, container) {
  if (!window.marked) {
    container.textContent = 'プレビューを読み込めませんでした。';
    return;
  }
  const template = document.createElement('template');
  template.innerHTML = window.marked.parse(withSlots(markdown));
  const content = template.content;
  content.querySelectorAll(DROP).forEach((el) => el.remove());
  for (const el of content.querySelectorAll('*')) {
    for (const { name, value } of [...el.attributes]) {
      const isUrl = name === 'href' || name === 'src' || name === 'xlink:href' || name === 'formaction';
      // ブラウザは URL 中のタブ・改行・制御文字を無視するので、除いてから判定する
      const url = value.replace(/[\u0000- \u007f]/g, '');
      if (name.startsWith('on') || (isUrl && /^javascript:/i.test(url))) {
        el.removeAttribute(name);
      }
    }
  }

  const body = document.createElement('div');
  body.className = 'post-body';
  body.append(content);
  const parts = [body];
  if (title !== null) {
    const heading = document.createElement('h1');
    heading.className = 'post-title';
    heading.textContent = title || '（無題）';
    parts.unshift(heading);
  }
  container.replaceChildren(...parts);
  body.querySelectorAll('.shortcode-slot').forEach(fillSlot);
  addCopyButtons(body);
}
