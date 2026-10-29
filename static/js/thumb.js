// サムネイル（手動設定があればそれ。無ければ自動。design.md §3・§11.6）。
// 画面の状態（state）と変更通知（markDirty）は引数で受け取る。editor.js は import しない
import { uploadImage } from './image.js';
import { showNotice } from './notice.js';

const $ = (id) => document.getElementById(id);

const BODY_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;

export function createThumb({ state, markDirty }) {
  // ---- サムネイル（手動設定があればそれ。無ければ自動。design.md §3・§11.6） ----

  // 今どう決まっているかを返す。自動の画像は本文の最初の画像（外部記事は OGP なのでプレビューなし）
  function thumbStatus() {
    if (state.thumbImage) return { url: state.thumbImage, label: '手動' };
    if (state.kind === 'external') return { url: '', label: '自動: OGP の画像（ビルド時に取得）' };
    const first = [...$('f-body').value.matchAll(BODY_IMAGE_RE)][0];
    if (first) return { url: first[1], label: '自動: 本文の最初の画像' };
    return { url: '', label: 'なし' };
  }

  function renderThumb() {
    const { url, label } = thumbStatus();
    const preview = $('thumb-preview');
    preview.hidden = !url;
    preview.src = url;
    $('thumb-state').textContent = label;
    $('thumb-pick').hidden = state.kind === 'external';
    $('thumb-choices').hidden = true;
  }

  // 本文中の画像を並べ、押したものを手動のサムネイルにする
  function showThumbChoices() {
    const box = $('thumb-choices');
    const urls = [...new Set([...$('f-body').value.matchAll(BODY_IMAGE_RE)].map((match) => match[1]))];
    box.replaceChildren(
      ...urls.map((url) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'thumb-choice';
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.width = 64;
        img.height = 64;
        img.loading = 'lazy';
        button.append(img);
        button.addEventListener('click', () => {
          state.thumbImage = url;
          box.hidden = true;
          renderThumb();
          markDirty();
        });
        return button;
      }),
    );
    if (!urls.length) box.textContent = '本文に画像がありません。';
    box.hidden = false;
  }

  // サムネイルの操作（自動に戻す・本文から選ぶ・画像を上げる）を付ける
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
    $('thumb-upload').addEventListener('click', () => $('thumb-file').click());
    $('thumb-file').addEventListener('change', async () => {
      const file = $('thumb-file').files[0];
      $('thumb-file').value = '';
      if (!file) return;
      showNotice('info', '画像をアップロードしています…');
      try {
        // 本文には挿入しない。URL だけを手動のサムネイルにする
        state.thumbImage = await uploadImage(file);
        renderThumb();
        markDirty();
      } catch (error) {
        showNotice('error', error.message);
      }
    });
  }

  return { renderThumb, attach };
}
