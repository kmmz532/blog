import { showNotice } from './notice.js';

const $ = (id) => document.getElementById(id);

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

const SOURCE_NAMES = { 'zenn.dev': 'Zenn', 'qiita.com': 'Qiita', 'note.com': 'note' };

export function isHttps(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

// 外部記事フォーム（design.md §3.1・§11.6）。画面の状態と他の部品は引数で受け取る。editor.js は import しない
export function createExternalForm({ state, markDirty, slugs, taxonomy, updateSummaryCount, refreshPreview }) {
  // ---- 外部記事 ----

  function sourceFromUrl(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return SOURCE_NAMES[host] ?? host;
    } catch {
      return '';
    }
  }

  // URL を入れたとき、サイト名が空か自動入力のままなら既定値を入れる
  function onExternalUrlInput() {
    const source = $('f-source');
    const guess = sourceFromUrl($('f-external').value.trim());
    if (guess && (source.value === '' || source.value === state.autoSource)) {
      source.value = guess;
      state.autoSource = guess;
    }
  }

  // URL の確定時に外部ページから項目を取る。入力済みの項目は上書きしない
  async function autofillExternal() {
    const url = $('f-external').value.trim();
    if (!isHttps(url)) return;
    showNotice('info', '外部ページから項目を取得しています…');
    const meta = await fetchExternalMeta(url);
    if (!meta) {
      showNotice('info', '自動取得できませんでした（手入力してください）。');
      return;
    }

    if (!$('f-title').value && meta.title) $('f-title').value = meta.title;
    if (!$('f-summary').value && meta.summary) {
      $('f-summary').value = meta.summary;
      $('summary-details').open = true;
      updateSummaryCount();
    }
    if (!state.tags.length && meta.tags.length) {
      state.tags = meta.tags.filter(Boolean);
      taxonomy.renderSelectedTags();
      taxonomy.renderTagSuggestions('');
    }
    if (!state.dateTouched && meta.date) {
      $('f-date').value = meta.date;
      slugs.syncAutoSlug();
    }
    const source = $('f-source');
    if (meta.source && (source.value === '' || source.value === state.autoSource)) {
      source.value = meta.source;
      state.autoSource = meta.source;
    }
    markDirty();
    showNotice('info', '外部ページから項目を取得しました。内容を確認してください。');
    refreshPreview();
  }

  function renderExternalCard(fields) {
    const article = document.createElement('article');
    article.className = 'carditem';

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const date = document.createElement('time');
    date.textContent = fields.date.slice(0, 10).replaceAll('-', '.');
    meta.append(date);
    if (fields.categories?.length) {
      const category = document.createElement('span');
      category.className = 'card-category';
      category.textContent = fields.categories.join(' / ');
      meta.append(category);
    }

    const heading = document.createElement('h2');
    heading.className = 'card-title';
    heading.textContent = fields.title || fields.url || '（無題）';
    // 外部リンクの表示はタイトルの横に出す（一覧カードと同じ）
    const source = document.createElement('span');
    source.className = 'card-external';
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-arrow-up-right-from-square';
    icon.setAttribute('aria-hidden', 'true');
    source.append(icon, ` ${fields.source || ''}`);
    heading.append(source);

    article.append(meta, heading);
    if (fields.summary) {
      const excerpt = document.createElement('p');
      excerpt.className = 'card-excerpt';
      excerpt.textContent = fields.summary;
      article.append(excerpt);
    }
    if (fields.tags.length) {
      const box = document.createElement('div');
      box.className = 'card-tags';
      for (const tag of fields.tags) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = `#${tag}`;
        box.append(chip);
      }
      article.append(box);
    }
    $('preview').replaceChildren(article);
  }


  function attach() {
    $('f-external').addEventListener('change', autofillExternal);
  }

  return { onExternalUrlInput, autofillExternal, renderExternalCard, attach };
}
