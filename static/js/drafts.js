// 下書きはこの端末の localStorage にだけ保存する（公開リポジトリに未公開記事を置かないため）。
import { getItem, setItem, removeItem, keys } from './storage.js';

const PREFIX = 'blog_draft:';
// slug は英小文字・数字・ハイフンのみなので、'_' で始めれば記事の slug と衝突しない
const NEW_SLUG = '_new';

export const draftKey = (slug) => `${PREFIX}${slug ?? NEW_SLUG}`;

export const hasDraft = (key) => getItem(key) !== null;

// 壊れた下書きは null
export function readDraft(key) {
  try {
    return JSON.parse(getItem(key));
  } catch {
    return null;
  }
}

export const writeDraft = (key, payload) => setItem(key, JSON.stringify(payload));

export const removeDraft = (key) => removeItem(key);

export function renderDrafts(list) {
  const items = keys()
    .filter((key) => key.startsWith(PREFIX))
    .flatMap((key) => {
      const draft = readDraft(key);
      return draft ? [{ slug: key.slice(PREFIX.length), draft }] : [];
    });

  list.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'card-meta';
    empty.textContent = '下書きはありません。';
    list.append(empty);
    return;
  }
  for (const { slug, draft } of items) {
    const isNew = slug === NEW_SLUG;
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = isNew ? '/edit/' : `/edit/?slug=${encodeURIComponent(slug)}`;
    link.textContent = draft.title || '（無題）';
    const meta = document.createElement('span');
    meta.className = 'card-meta';
    meta.textContent = ` ${isNew ? '新規' : slug}・${new Date(draft.savedAt).toLocaleString('ja-JP')}`;
    item.append(link, meta);
    list.append(item);
  }
}
