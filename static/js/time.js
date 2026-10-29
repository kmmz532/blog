// 記事の日付は日本時間で扱う。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const jstNow = () => new Date(Date.now() + JST_OFFSET_MS);

// datetime-local と同じ 'YYYY-MM-DDTHH:mm' 形式
export const nowJst = () => jstNow().toISOString().slice(0, 16);

export const jstYear = () => jstNow().getUTCFullYear();
