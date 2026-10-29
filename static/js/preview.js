// marked の出力は HTML として挿入するため、危険な要素と属性を落としてから描画する。
const DROP = 'script, iframe, object, embed, style, link, meta, base, form';

export function renderPreview(markdown, container) {
  if (!window.marked) {
    container.textContent = 'プレビューを読み込めませんでした。';
    return;
  }
  const template = document.createElement('template');
  template.innerHTML = window.marked.parse(markdown);
  const content = template.content;
  content.querySelectorAll(DROP).forEach((el) => el.remove());
  for (const el of content.querySelectorAll('*')) {
    for (const { name, value } of [...el.attributes]) {
      const isUrl = name === 'href' || name === 'src';
      if (name.startsWith('on') || (isUrl && /^\s*javascript:/i.test(value))) {
        el.removeAttribute(name);
      }
    }
  }
  container.replaceChildren(content);
}
