// 索引（gh-admin/index.json など）を 1 ファイルずつ読む。next をたどり、slug で重複を除く。
// onPage(読んだ分, 全件数) は 1 ファイルごとに呼ぶ。stop(読んだ分) が true を返したら、そこで読むのを止める。
export async function loadIndex(url, { onPage, stop } = {}) {
  const seen = new Set();
  const items = [];
  let next = url;
  while (next) {
    const res = await fetch(next, { cache: 'no-store' });
    if (!res.ok) throw new Error(`索引を読めませんでした（${res.status}）`);
    const page = await res.json();
    for (const item of page.items) {
      if (seen.has(item.slug)) continue;
      seen.add(item.slug);
      items.push(item);
    }
    onPage?.(items, page.total);
    if (stop?.(items)) break;
    next = page.next;
  }
  return items;
}
