// 下書きはこの端末の localStorage にだけ保存する（公開リポジトリに未公開記事を置かないため）。
import { getItem, setItem, removeItem, keys } from './storage.js';
import { setSaveState, showNotice } from './notice.js';

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

const $ = (id) => document.getElementById(id);

// 下書きの画面側の処理（保存・お知らせ・復元と破棄）。画面の状態と画面の関数は引数で受け取る。editor.js は import しない
export function createDrafts({ state, readForm, writeForm, refreshPreview, updateChrome }) {
  // ---- 下書き ----

  function saveDraft() {
    // 復元か破棄を選ぶまでは、残っている下書きを上書きしない
    if (state.pendingDraft) return;
    const payload = {
      ...readForm(),
      sha: state.sha,
      aliases: state.aliases,
      extra: state.extra,
      savedAt: new Date().toISOString(),
    };
    if (!writeDraft(draftKey(state.originalSlug), payload)) {
      showNotice('error', '下書きを保存できませんでした。');
    } else {
      const time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      setSaveState('draft', `下書き保存 ${time}`);
    }
    renderDrafts($('drafts'));
  }

  // 下書きの案内は、上のお知らせ欄ではなく「下書き」の折りたたみの中に出す（本文の邪魔にならないように）。
  // 選ぶまでは折りたたみを開いたままにし、見出しにも「復元待ち」と出して忘れないようにする
  const SUMMARY = '下書き（この端末のみ）';

  function showDraftNotice(key, draft) {
    state.pendingDraft = { key, draft };
    const time = new Date(draft.savedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    $('draft-pending-text').textContent = `この記事の下書きがあります（${time} 保存）。復元か破棄を選ぶまで、新しい下書きは保存されません。`;
    $('draft-pending').hidden = false;
    $('drafts-summary').textContent = `${SUMMARY}・復元待ち`;
    $('drafts-details').classList.add('has-pending');
    $('drafts-details').open = true;
    // 記事設定が本文の下に回る狭い画面でも気づけるように、編集バーの保存状態にも短く出す
    setSaveState('draft', '未復元の下書きあり');
  }

  function closeDraftNotice() {
    state.pendingDraft = null;
    $('draft-pending').hidden = true;
    $('drafts-summary').textContent = SUMMARY;
    $('drafts-details').classList.remove('has-pending');
  }

  $('draft-restore').addEventListener('click', () => restoreDraft());
  $('draft-drop').addEventListener('click', () => discardDraft());

  function restoreDraft() {
    if (!state.pendingDraft) return;
    const { draft } = state.pendingDraft;
    closeDraftNotice();
    writeForm(draft);
    state.categoryPicked = true;
    state.sha = draft.sha ?? null;
    state.aliases = draft.aliases ?? [];
    state.extra = draft.extra ?? [];
    state.dirty = true;
    updateChrome();
    refreshPreview();
    showNotice('info', '下書きを復元しました。');
  }

  function discardDraft() {
    if (!state.pendingDraft) return;
    removeDraft(state.pendingDraft.key);
    closeDraftNotice();
    renderDrafts($('drafts'));
    showNotice('info', '下書きを破棄しました。');
  }


  return { saveDraft, showDraftNotice, closeDraftNotice };
}
