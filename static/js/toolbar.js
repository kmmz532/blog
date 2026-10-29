// 本文欄のツールバーと、画像の 3 経路（ボタン・貼り付け・ドロップ）。
// 画像は upload で保存し、仮テキストを置いてから実 URL に差し替える。失敗したら仮テキストを消す。
let uploadCount = 0;

function wrapSelection(textarea, before, after, fallback) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end) || fallback;
  textarea.setRangeText(before + selected + after, start, end, 'end');
  textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
}

function prefixLine(textarea, prefix) {
  const start = textarea.selectionStart;
  const lineStart = textarea.value.lastIndexOf('\n', start - 1) + 1;
  textarea.setRangeText(prefix, lineStart, lineStart, 'end');
}

const ACTIONS = {
  bold: (ta) => wrapSelection(ta, '**', '**', '太字'),
  italic: (ta) => wrapSelection(ta, '*', '*', '斜体'),
  heading: (ta) => prefixLine(ta, '## '),
  link: (ta) => wrapSelection(ta, '[', '](https://)', 'リンク'),
  list: (ta) => prefixLine(ta, '- '),
  quote: (ta) => prefixLine(ta, '> '),
  code: (ta) => {
    const multiline = ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n');
    if (multiline) wrapSelection(ta, '```\n', '\n```', 'コード');
    else wrapSelection(ta, '`', '`', 'コード');
  },
};

function imageFile(list) {
  return [...(list ?? [])].find((file) => file.type.startsWith('image/')) ?? null;
}

export function altFrom(file) {
  return file.name ? file.name.replace(/\.[^.]+$/, '').replace(/[[\]|]/g, '') : 'image';
}

// 表示幅（px）は alt の末尾に |数字 で付ける（design.md §19）。空なら元のまま
export const withWidth = (alt, width) => (width ? `${alt}|${width}` : alt);

// 仮テキストを置き、保存が終わったら差し替える。すべて textarea の input イベントで通知する
async function insertImage(textarea, file, upload, onError, width = '') {
  // 仮テキストに番号を付け、同時に複数の画像を貼っても差し替え先を取り違えないようにする
  const placeholder = `![アップロード中…(${++uploadCount})]()`;
  const start = textarea.selectionStart;
  textarea.setRangeText(placeholder, start, textarea.selectionEnd, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));

  const alt = withWidth(altFrom(file), width);
  const replaceWith = (text) => {
    const index = textarea.value.indexOf(placeholder);
    if (index === -1) return;
    textarea.setRangeText(text, index, index + placeholder.length, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };

  try {
    const url = await upload(file);
    replaceWith(`![${alt}](${url})`);
  } catch (error) {
    replaceWith('');
    onError(error.message);
  }
}

// 1 行の URL だけ（前後の空白は可）。" を含むと記法が壊れるので除く
const URL_ONLY = /^\s*(https?:\/\/[^\s"]+)\s*$/;

// execCommand で入れると、ブラウザの undo に載る（value に代入すると undo が効かない）
function insertText(textarea, text) {
  document.execCommand('insertText', false, text);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

// URL を入れてから、その URL をカード記法に置き換える。2 回に分けるので、Ctrl+Z 1 回で URL に戻る（design.md §18）
function insertCardFromUrl(textarea, url) {
  const start = textarea.selectionStart;
  insertText(textarea, url);
  textarea.setSelectionRange(start, start + url.length);
  insertText(textarea, `{{< link-card url="${url}" >}}`);
}

// 本文のカーソル位置に画像を入れる（画像の一覧から選んだとき・一覧から上げたとき）
export function insertImageMarkdown(textarea, url, alt = 'image', width = '') {
  textarea.setRangeText(`![${withWidth(alt, width)}](${url})`, textarea.selectionStart, textarea.selectionEnd, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function attachToolbar({ textarea, toolbar, fileInput, upload, onError, confirmUpload = async () => '' }) {
  // 貼り付け・ドロップは誤爆しやすいので、上げる前に確認する。画像ボタンは自分でファイルを選ぶので確認しない
  async function insertConfirmed(file) {
    // 確認の戻り値は表示幅（'' は元のまま）。やめるなら null
    const width = await confirmUpload(file);
    if (width !== null) insertImage(textarea, file, upload, onError, width);
    textarea.focus();
  }

  toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'image') {
      fileInput.click();
      return;
    }
    ACTIONS[action]?.(textarea);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  });

  // 本文欄の中のショートカット（ツールバーの title に書いたもの）。Ctrl+S・Ctrl+Enter は editor.js
  const SHORTCUTS = { b: 'bold', i: 'italic', k: 'link' };
  textarea.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const action = SHORTCUTS[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    ACTIONS[action](textarea);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) insertImage(textarea, file, upload, onError);
  });

  // テキストの貼り付けは通常どおり。画像と URL 1 つだけのときは横取りする
  textarea.addEventListener('paste', (event) => {
    const file = imageFile(event.clipboardData?.files);
    if (file) {
      event.preventDefault();
      insertConfirmed(file);
      return;
    }
    const url = URL_ONLY.exec(event.clipboardData?.getData('text/plain') ?? '')?.[1];
    if (!url) return;
    event.preventDefault();
    insertCardFromUrl(textarea, url);
  });

  textarea.addEventListener('dragover', (event) => {
    if (!imageFile(event.dataTransfer?.files)) return;
    event.preventDefault();
    textarea.classList.add('dragover');
  });
  textarea.addEventListener('dragleave', () => textarea.classList.remove('dragover'));
  textarea.addEventListener('drop', (event) => {
    textarea.classList.remove('dragover');
    const file = imageFile(event.dataTransfer?.files);
    if (!file) return;
    event.preventDefault();
    insertConfirmed(file);
  });
}
