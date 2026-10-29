// 貼り付け・ドロップで画像を上げる前の確認（design.md §19）。blog-article は public なので、上げた時点で誰でも見られる。
// ダイアログの中身は textContent と属性だけで作る
const $ = (id) => document.getElementById(id);

// 上げてよければ選んだ表示幅（'' は元のまま）。やめる・Esc・枠の外なら null
export function confirmImageUpload(file) {
  const dialog = $('upload-confirm');
  const url = URL.createObjectURL(file);
  $('upload-confirm-image').src = url;
  $('upload-confirm-name').textContent = `${file.name || '貼り付けた画像'}（${Math.max(1, Math.round(file.size / 1024))} KB）`;

  return new Promise((resolve) => {
    const finish = () => {
      URL.revokeObjectURL(url);
      $('upload-confirm-image').removeAttribute('src');
      resolve(dialog.returnValue === 'upload' ? $('upload-confirm-size').value : null);
    };
    dialog.returnValue = '';
    dialog.addEventListener('close', finish, { once: true });
    dialog.showModal();
    $('upload-confirm-ok').focus();
  });
}

export function attachUploadConfirm() {
  const dialog = $('upload-confirm');
  $('upload-confirm-ok').addEventListener('click', () => dialog.close('upload'));
  $('upload-confirm-cancel').addEventListener('click', () => dialog.close('cancel'));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close('cancel');
  });
}
