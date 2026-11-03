// サムネイル（手動設定があればそれ。無ければ自動）
// 画面の状態（state）と変更通知（markDirty）は引数で受け取る。editor.js は import しない
import { loadIndex } from './index-loader.js';
import { uploadImage, imageSrc } from './image.js';
import { showNotice } from './notice.js';
import { isHttps } from './external.js';
import { loadOgpIndex } from './preview.js';

const $ = (id) => document.getElementById(id);

// 記法の alt（[1]）と URL（[2]）。alt の末尾の |数字 は表示幅なので、表示名からは外す
const BODY_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
const WIDTH_SUFFIX_RE = /\|\d+$/;
// 本文の link-card の URL（[1]）。カードの OGP 画像を候補にする
const LINK_CARD_RE = /\{\{<\s*link-card\s+url="([^"]+)"/g;

export function createThumb({ state, markDirty }) {
  // ---- サムネイル（手動設定があればそれ。無ければ自動） ----

  // 今どう決まっているかを返す。自動の画像は本文の最初の画像（外部記事は OGP なのでプレビューなし）
  function thumbStatus() {
    if (state.thumbImage) return { url: state.thumbImage, label: '手動' };
    if (state.kind === 'external') return { url: '', label: '自動: OGP の画像（ビルド時に取得）' };
    const first = [...$('f-body').value.matchAll(BODY_IMAGE_RE)][0];
    if (first) return { url: first[2], label: '自動: 本文の最初の画像' };
    return { url: '', label: 'なし' };
  }

  function renderThumb() {
    const { url, label } = thumbStatus();
    const external = state.kind === 'external';
    const preview = $('thumb-preview');
    preview.hidden = !url;
    preview.src = imageSrc(url);
    $('thumb-state').textContent = label;
    $('thumb-pick').textContent = external ? 'OGP の画像から選ぶ' : '本文の画像から選ぶ';
    $('thumb-url-row').hidden = !external;
    $('thumb-choices').hidden = true;
  }

  // 手動のサムネイルに決める。どこから選んでも同じ後始末をする
  function setManual(url) {
    state.thumbImage = url;
    $('thumb-details').open = true;
    renderThumb();
    markDirty();
  }

  // 候補の 1 件。画像の下に番号付きの名前を出す（名前は textContent で描画する）
  function choice({ url, caption }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'thumb-choice';
    const img = document.createElement('img');
    img.src = imageSrc(url);
    img.alt = '';
    img.width = 120;
    img.height = 120;
    img.loading = 'lazy';
    const name = document.createElement('span');
    name.className = 'thumb-choice-name';
    name.textContent = caption;
    button.append(img, name);
    button.addEventListener('click', () => setManual(url));
    return button;
  }

  // 本文の画像（同じ URL は 1 つにまとめ、最初に出てきた alt を名前にする）
  function bodyChoices() {
    const seen = new Map();
    for (const [, alt, url] of $('f-body').value.matchAll(BODY_IMAGE_RE)) {
      if (!seen.has(url)) seen.set(url, alt.replace(WIDTH_SUFFIX_RE, '').trim());
    }
    return [...seen].map(([url, alt], i) => ({
      url,
      caption: `${i + 1}. ${alt || url.split('/').pop()}`,
    }));
  }

  // 本文の link-card のカードの OGP 画像（ビルド時に取れたもの。/ogp/index.json）。カードの順に出し、同じ画像は 1 つにまとめる
  async function cardChoices() {
    const map = await loadOgpIndex();
    const seen = new Set();
    const items = [];
    // 番号は本文に出てくる順（同じ画像を外したカードの番号も詰めない）
    [...$('f-body').value.matchAll(LINK_CARD_RE)].forEach(([, url], i) => {
      const card = map.get(url);
      if (!card?.image || !isHttps(card.image) || seen.has(card.image)) return;
      seen.add(card.image);
      items.push({ url: card.image, caption: `${i + 1}. カード: ${card.title || url}` });
    });
    return items;
  }

  // 公開済みの外部記事なら、ビルド時に取った OGP の画像（index.json の images）を読む。未公開なら空
  async function externalChoices() {
    if (state.originalSlug === null) return [];
    try {
      let post;
      await loadIndex($('post-form').dataset.indexUrl, {
        stop: (items) => {
          post = items.find((item) => item.slug === state.originalSlug);
          return Boolean(post);
        },
      });
      return (post?.images ?? []).map((url, i) => ({ url, caption: `OGP ${i + 1}` }));
    } catch {
      return [];
    }
  }

  // 候補を並べ、押したものを手動のサムネイルにする
  async function showThumbChoices() {
    const box = $('thumb-choices');
    box.hidden = false;
    if (state.kind !== 'external') {
      box.textContent = '読み込んでいます…';
      const items = [...bodyChoices(), ...(await cardChoices())];
      box.replaceChildren(...items.map(choice));
      if (!items.length) box.textContent = '本文に画像がありません。';
      return;
    }
    box.textContent = '読み込んでいます…';
    const items = await externalChoices();
    box.replaceChildren(...items.map(choice));
    if (!items.length) box.textContent = 'OGP の画像が見つかりません。公開すると候補が出ます。URL を直接指定することもできます。';
  }

  // サムネイルの操作（自動に戻す・候補から選ぶ・URL を指定する・画像を上げる）を付ける
  function attach() {
    $('thumb-auto').addEventListener('click', () => {
      state.thumbImage = '';
      renderThumb();
      markDirty();
    });
    $('thumb-pick').addEventListener('click', () => {
      if ($('thumb-choices').hidden) showThumbChoices();
      else $('thumb-choices').hidden = true;
    });
    $('thumb-url-set').addEventListener('click', () => {
      const url = $('thumb-url').value.trim();
      if (!isHttps(url)) {
        showNotice('error', '画像の URL は https:// で始まるものを入れてください。');
        return;
      }
      $('thumb-url').value = '';
      setManual(url);
    });
    $('thumb-upload').addEventListener('click', () => $('thumb-file').click());
    $('thumb-file').addEventListener('change', async () => {
      const file = $('thumb-file').files[0];
      $('thumb-file').value = '';
      if (!file) return;
      showNotice('info', '画像をアップロードしています…');
      try {
        // 本文には挿入しない。URL だけを手動のサムネイルにする
        setManual(await uploadImage(file));
      } catch (error) {
        showNotice('error', error.message);
      }
    });
  }

  return { renderThumb, setManual, attach };
}
