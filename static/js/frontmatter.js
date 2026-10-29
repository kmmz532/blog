// 記事ファイルの front matter を読み書きする。副作用はない。
import { dateToJstInput } from './time.js';

// 画面で扱うキー。それ以外は raw 行のまま保持して書き戻す。build は読み込みで捨てて保存で作り直す
const KNOWN_KEYS = ['title', 'date', 'categories', 'tags', 'summary', 'aliases', 'external', 'source', 'build'];
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
      category: values.categories?.[0] ?? 'tech',
      tags: values.tags ?? [],
      summary: String(values.summary ?? ''),
      url: String(values.external ?? ''),
      source: String(values.source ?? ''),
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
    `categories: ${JSON.stringify([fields.category])}`,
    `tags: ${JSON.stringify(fields.tags)}`,
    `summary: ${JSON.stringify(fields.summary)}`,
  ];
}

export function buildArticle(fields, aliases, extra) {
  const lines = [
    ...frontFields(fields),
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
