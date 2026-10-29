// 記事ファイルの front matter を読み書きする。副作用はない。
import { dateToJstInput } from './time.js';

// 画面で扱うキー。それ以外は raw 行のまま保持して書き戻す。build は読み込みで捨てて保存で作り直す
const KNOWN_KEYS = ['title', 'date', 'lastmod', 'categories', 'tags', 'summary', 'image', 'aliases', 'external', 'source', 'build'];
const LIST_KEYS = ['categories', 'tags', 'aliases'];
const EXTERNAL_BUILD = '{"render": "never", "list": "always"}';

function unquote(raw) {
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      // 下の処理に任せる
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}

// 解釈できなければ undefined
function parseField(key, lines) {
  const head = lines[0].slice(key.length + 1).trim();
  if (LIST_KEYS.includes(key)) {
    if (head === '') {
      const items = lines.slice(1).map((line) => line.match(/^\s*-\s*(.*)$/)?.[1]);
      if (items.length && items.every((item) => item !== undefined)) {
        return items.map((item) => unquote(item.trim()));
      }
      return undefined;
    }
    try {
      const value = JSON.parse(head);
      return Array.isArray(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return lines.length === 1 ? unquote(head) : undefined;
}

export function parseArticle(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const front = match ? match[1] : '';
  const body = match ? match[2].replace(/^\r?\n/, '') : text;

  const blocks = [];
  for (const line of front.split(/\r?\n/)) {
    const key = line.match(/^([A-Za-z_][\w-]*):/)?.[1];
    if (key) blocks.push({ key, lines: [line] });
    else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
  }

  const values = {};
  const extra = [];
  for (const { key, lines } of blocks) {
    if (key === 'build') continue;
    if (!KNOWN_KEYS.includes(key)) {
      extra.push(...lines);
      continue;
    }
    // 画面で扱うキーを extra に回すと書き戻し時にキーが重複するので、読み込みを止める
    const value = parseField(key, lines);
    if (value === undefined) {
      throw new Error(`front matter の ${key} を解釈できません。リポジトリ上で 1 行の形式に直してください。`);
    }
    values[key] = value;
  }

  const date = String(values.date ?? '');
  const isExternal = values.external !== undefined;
  return {
    kind: isExternal ? 'external' : 'article',
    fields: {
      slug: '',
      title: String(values.title ?? ''),
      date: dateToJstInput(date),
      // 階層の順のリスト（先頭が一番上）。旧形式の 1 つだけのリストもそのまま読める（design.md §16）
      categories: values.categories?.length ? values.categories : ['tech'],
      tags: values.tags ?? [],
      summary: String(values.summary ?? ''),
      image: String(values.image ?? ''),
      url: String(values.external ?? ''),
      source: String(values.source ?? ''),
      // 更新日。画面では扱わず、更新のたびに保存時の値で上書きする（design.md §14.4）
      lastmod: String(values.lastmod ?? ''),
      body,
    },
    aliases: values.aliases ?? [],
    extra,
  };
}

// 日時は JST 固定。入力された分単位の値に秒と +09:00 を付ける
function frontFields(fields) {
  return [
    `title: ${JSON.stringify(fields.title)}`,
    `date: ${fields.date}:00+09:00`,
    `categories: ${JSON.stringify(fields.categories)}`,
    `tags: ${JSON.stringify(fields.tags)}`,
    `summary: ${JSON.stringify(fields.summary)}`,
    // 手動のサムネイルは設定したときだけ書く
    ...(fields.image ? [`image: ${JSON.stringify(fields.image)}`] : []),
  ];
}

export function buildArticle(fields, aliases, extra) {
  const lines = [
    ...frontFields(fields),
    ...(fields.lastmod ? [`lastmod: ${fields.lastmod}`] : []),
    ...(aliases.length ? [`aliases: ${JSON.stringify(aliases)}`] : []),
    ...extra,
  ];
  const body = fields.body.replace(/^\n+/, '').replace(/\s+$/, '');
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
}

// 外部記事は本文を持たず、詳細ページも作らない（設計書 §3.1）
export function buildExternal(fields, extra) {
  const lines = [
    ...frontFields(fields),
    `external: ${JSON.stringify(fields.url)}`,
    `source: ${JSON.stringify(fields.source)}`,
    `build: ${EXTERNAL_BUILD}`,
    ...extra,
  ];
  return `---\n${lines.join('\n')}\n---\n`;
}

// 一括操作の変換（design.md §17）。カテゴリを置き換え（null なら変えない）、タグを追加・削除する。
// 本文・他の項目・lastmod は変えない。記事と外部記事のどちらも同じ形で扱う
export function applyBulk(text, { categories = null, addTags = [], removeTags = [] }) {
  const parsed = parseArticle(text);
  const tags = parsed.fields.tags.filter((tag) => !removeTags.includes(tag));
  for (const tag of addTags) {
    if (!tags.includes(tag)) tags.push(tag);
  }
  const fields = {
    ...parsed.fields,
    categories: categories ?? parsed.fields.categories,
    tags,
  };
  return parsed.kind === 'external'
    ? buildExternal(fields, parsed.extra)
    : buildArticle(fields, parsed.aliases, parsed.extra);
}
