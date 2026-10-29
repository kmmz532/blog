// コードブロックのコピーボタン（design.md §14.3）。ボタンは JS で付けるので、JS が無いときは出ない。
// 記事詳細（single.html）とプレビュー（preview.js）から使う。

const CHECK_MS = 2000;

function icon(className) {
  const node = document.createElement('i');
  node.className = className;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

// root の中のコードブロックそれぞれに、右上のコピーボタンを付ける。二重には付けない
export function addCopyButtons(root) {
  if (!root) return;
  for (const pre of root.querySelectorAll('pre')) {
    if (pre.querySelector('.copy-code')) continue;
    const code = pre.querySelector('code') ?? pre;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-code';
    button.setAttribute('aria-label', 'コードをコピー');
    button.title = 'コードをコピー';
    const mark = icon('fa-regular fa-copy');
    button.append(mark);
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
      } catch {
        // コピーできない環境では何もしない（ボタンは変わらない）
        return;
      }
      mark.className = 'fa-solid fa-check';
      setTimeout(() => {
        mark.className = 'fa-regular fa-copy';
      }, CHECK_MS);
    });
    pre.append(button);
  }
}
