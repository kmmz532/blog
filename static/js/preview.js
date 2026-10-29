import { addCopyButtons } from './copy.js';
import { imageSrc } from './image.js';

// marked の出力は HTML として挿入するため、危険な要素と属性を落としてから描画する。
// 記事詳細（single.html）と同じ見た目になるよう、タイトルと本文を同じクラスで出す。
// title が null のときはタイトルを出さない（編集画面は本文欄の上にタイトル入力があるため）。
const DROP = 'script, iframe, object, embed, style, link, meta, base, form';
// 本文の記法（design.md §18）。コードブロックの外だけ変換する。行の途中にあっても変換する
const SHORTCODE_LINE = /\{\{<\s*(link-card|tweet|youtube|instagram|vimeo|niconico|soundcloud|facebook)\s+(?:url|id)="([^"]+)"\s*>\}\}/g;
const TWEET_URL = /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/\d+/;
const INSTAGRAM_URL = /^https:\/\/(?:www\.)?instagram\.com\/(p|reel)\/([A-Za-z0-9_-]+)\/?/;
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

// Instagram の投稿は iframe で埋め込む（design.md §18）。URL の形が違えば通常のリンク
function fillInstagram(slot, url) {
  const match = INSTAGRAM_URL.exec(url);
  if (!match) {
    slot.replaceChildren(plainLink(url));
    return;
  }
  const frame = document.createElement('iframe');
  frame.src = `https://www.instagram.com/${match[1]}/${match[2]}/embed`;
  frame.title = 'Instagram の投稿';
  frame.loading = 'lazy';
  const wrap = makeElement('div', 'instagram-embed');
  wrap.append(frame);
  slot.replaceChildren(wrap);
}

// iframe の埋め込みを作る。wrapClass は 16:9 の動画枠（video-embed）か、音声の枠（audio-embed）
function fillFrame(slot, src, title, wrapClass) {
  const frame = document.createElement('iframe');
  frame.src = src;
  frame.title = title;
  frame.loading = 'lazy';
  frame.allowFullscreen = wrapClass === 'video-embed';
  const wrap = makeElement('div', wrapClass);
  wrap.append(frame);
  slot.replaceChildren(wrap);
}

function fillVimeo(slot, id) {
  if (!/^[0-9]+$/.test(id)) {
    slot.replaceChildren(makeElement('span', 'shortcode-error', `Vimeo の ID が正しくありません: ${id}`));
    return;
  }
  fillFrame(slot, `https://player.vimeo.com/video/${id}`, 'Vimeo の動画', 'video-embed');
}

function fillNiconico(slot, id) {
  if (!/^(sm|nm|so)?[0-9]+$/.test(id)) {
    slot.replaceChildren(makeElement('span', 'shortcode-error', `ニコニコ動画の ID が正しくありません: ${id}`));
    return;
  }
  fillFrame(slot, `https://embed.nicovideo.jp/watch/${id}`, 'ニコニコ動画の動画', 'video-embed');
}

function fillSoundcloud(slot, url) {
  if (!/^https:\/\/soundcloud\.com\/[^/\s"]+\/[^/\s"]+/.test(url)) {
    slot.replaceChildren(plainLink(url));
    return;
  }
  fillFrame(slot, `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}`, 'SoundCloud の曲', 'audio-embed');
}

function fillFacebook(slot, url) {
  if (!/^https:\/\/(?:www\.|m\.)?facebook\.com\/[^\s"]+/.test(url)) {
    slot.replaceChildren(plainLink(url));
    return;
  }
  fillFrame(slot, `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(url)}&width=500`, 'Facebook の投稿', 'facebook-embed');
}

function fillSlot(slot) {
  const value = decodeURIComponent(slot.dataset.value);
  const name = slot.dataset.name;
  if (name === 'youtube') fillYoutube(slot, value);
  else if (name === 'tweet') fillTweet(slot, value);
  else if (name === 'instagram') fillInstagram(slot, value);
  else if (name === 'vimeo') fillVimeo(slot, value);
  else if (name === 'niconico') fillNiconico(slot, value);
  else if (name === 'soundcloud') fillSoundcloud(slot, value);
  else if (name === 'facebook') fillFacebook(slot, value);
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

  // 公開前や手元の確認では /images/... が開けないので、見られる URL に差し替える
  content.querySelectorAll('img[src^="/images/"]').forEach((img) => {
    img.src = imageSrc(img.getAttribute('src'));
  });

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
