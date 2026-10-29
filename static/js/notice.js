// 編集画面の表示を 2 つに分ける（design.md §11.6）。
// 保存状態は編集バーの左（公開ボタンの横）に短い文言で、それ以外のメッセージはお知らせ欄（編集バーの直下）に出す。
const $ = (id) => document.getElementById(id);

const SAVE_ICONS = {
  unsaved: 'fa-circle',
  draft: 'fa-floppy-disk',
  publishing: 'fa-spinner fa-spin',
  published: 'fa-check',
};
const NOTICE_ICONS = {
  error: 'fa-circle-exclamation',
  info: 'fa-circle-info',
  success: 'fa-circle-check',
};
const AUTO_HIDE_MS = 6000;
let hideTimer = 0;

// kind: 'unsaved' | 'draft' | 'publishing' | 'published'。幅が狭いときは文言を隠し、アイコンだけ出す
export function setSaveState(kind, text) {
  const el = $('save-state');
  const icon = document.createElement('i');
  icon.className = `fa-solid ${SAVE_ICONS[kind]}`;
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'save-state-text';
  label.textContent = text;
  el.title = text;
  el.replaceChildren(icon, label);
}

// type: 'error' | 'info' | 'success'。actions（[{ label, onClick }]）があるお知らせは、選ぶまで消えない。
// error は × で閉じるか、原因が直るまで残る。info と success は 6 秒で消える。新しいお知らせは前のものを置き換える
export function showNotice(type, message, actions = []) {
  clearTimeout(hideTimer);
  const el = $('notice');
  el.className = `notice ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const icon = document.createElement('i');
  icon.className = `fa-solid ${NOTICE_ICONS[type]}`;
  icon.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.className = 'notice-text';
  text.textContent = message;

  const buttons = actions.map(({ label, onClick, primary = false }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'btn primary' : 'btn';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  });

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'notice-close';
  close.setAttribute('aria-label', '閉じる');
  close.title = '閉じる';
  close.textContent = '×';
  close.addEventListener('click', hideNotice);

  el.replaceChildren(icon, text, ...buttons, close);
  el.hidden = false;
  if (type !== 'error' && actions.length === 0) hideTimer = setTimeout(hideNotice, AUTO_HIDE_MS);
}

export function hideNotice() {
  clearTimeout(hideTimer);
  $('notice').hidden = true;
}
