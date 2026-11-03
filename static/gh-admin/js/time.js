// 記事の日付は日本時間で扱う。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const jstNow = () => new Date(Date.now() + JST_OFFSET_MS);

// datetime-local と同じ 'YYYY-MM-DDTHH:mm' 形式
export const nowJst = () => jstNow().toISOString().slice(0, 16);

export const jstYear = () => jstNow().getUTCFullYear();

// front matter の日付を JST の 'YYYY-MM-DDTHH:mm' にする。オフセットなしはそのまま。
export const dateToJstInput = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(date)) return nowJst();
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(date)) return date.slice(0, 16);
  const parsed = Date.parse(date.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return new Date(parsed + JST_OFFSET_MS).toISOString().slice(0, 16);
};
