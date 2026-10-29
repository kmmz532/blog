// marked の出力は HTML として挿入するため、危険な要素と属性を落としてから描画する。
// 記事詳細（single.html）と同じ見た目になるよう、タイトルと本文を同じクラスで出す。
const DROP = 'script, iframe, object, embed, style, link, meta, base, form';

export function renderPreview(markdown, title, container) {
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
      const isUrl = name === 'href' || name === 'src' || name === 'xlink:href' || name === 'formaction';
      // ブラウザは URL 中のタブ・改行・制御文字を無視するので、除いてから判定する
      const url = value.replace(/[\u0000- \u007f]/g, '');
      if (name.startsWith('on') || (isUrl && /^javascript:/i.test(url))) {
        el.removeAttribute(name);
      }
    }
  }

  const heading = document.createElement('h1');
  heading.className = 'post-title';
  heading.textContent = title || '（無題）';
  const body = document.createElement('div');
  body.className = 'post-body';
  body.append(content);
  container.replaceChildren(heading, body);
}
