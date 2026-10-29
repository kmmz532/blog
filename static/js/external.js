// 外部記事の URL からタイトルなどを取る（ブラウザ側）。取れなければ null を返し、呼び出し側は手入力に任せる。
// 取得した文字列は値として返すだけで、HTML としては描画しない。認証ヘッダーは付けない。
const HATENA_HOST = /\.(hatenablog\.com|hatenablog\.jp|hateblo\.jp|hatenadiary\.com|hatenadiary\.jp)$/;
const SUMMARY_LENGTH = 120;

// JST の 'YYYY-MM-DDTHH:mm'（datetime-local と同じ形式）
function toJstInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function plainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>~|-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SUMMARY_LENGTH);
}

async function fromQiita(url) {
  const id = url.pathname.split('/items/')[1]?.split('/')[0];
  if (!id) return null;
  const res = await fetch(`https://qiita.com/api/v2/items/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const item = await res.json();
  return {
    title: item.title ?? '',
    date: toJstInput(item.created_at),
    tags: (item.tags ?? []).map((tag) => tag.name),
    summary: plainText(item.body ?? ''),
    source: 'Qiita',
  };
}

// はてなブログは最新の数十件の Atom フィードから探す。見つからなければ null
async function fromHatena(url) {
  const res = await fetch(`${url.origin}/feed`);
  if (!res.ok) return null;
  const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
  const entry = [...xml.getElementsByTagName('entry')].find((item) =>
    [...item.getElementsByTagName('link')].some((link) => link.getAttribute('href') === url.href),
  );
  if (!entry) return null;
  const text = (name) => entry.getElementsByTagName(name)[0]?.textContent ?? '';
  return {
    title: text('title'),
    date: toJstInput(text('published')),
    tags: [...entry.getElementsByTagName('category')].map((cat) => cat.getAttribute('term')),
    summary: plainText(text('summary')),
    source: 'はてなブログ',
  };
}

// 一般の記事は HTML の meta から読む。CORS で拒否されるサイトはここで失敗する
async function fromPage(url) {
  const res = await fetch(url.href);
  if (!res.ok) return null;
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const meta = (key) =>
    doc.querySelector(`meta[property="${key}"]`)?.getAttribute('content') ??
    doc.querySelector(`meta[name="${key}"]`)?.getAttribute('content') ??
    '';
  const title = meta('og:title') || doc.title || '';
  if (!title) return null;
  return {
    title,
    date: toJstInput(meta('article:published_time')),
    tags: [],
    summary: meta('og:description').slice(0, SUMMARY_LENGTH),
    source: '',
  };
}

export async function fetchExternalMeta(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  try {
    if (url.hostname === 'qiita.com') {
      const meta = await fromQiita(url);
      if (meta) return meta;
    } else if (HATENA_HOST.test(url.hostname)) {
      const meta = await fromHatena(url);
      if (meta) return meta;
    }
    return await fromPage(url);
  } catch {
    // CORS で拒否された・ネットワークが無いなど。手入力に任せる
    return null;
  }
}
