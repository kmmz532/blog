// 公開・slug 変更・削除（design.md §7）。画面の状態と部品は引数で受け取る。editor.js は import しない
import { savePost, deletePost, ConflictError } from './github.js';
import { buildArticle, buildExternal } from './frontmatter.js';
import { draftKey, removeDraft, renderDrafts } from './drafts.js';
import { setSaveState, showNotice } from './notice.js';
import { recordSave, recordDelete } from './pending.js';

const $ = (id) => document.getElementById(id);
const AUTO_SLUG_TRIES = 5;

function errorMessage(error, creating) {
  if (error instanceof ConflictError) {
    return creating
      ? '同じ slug の記事が既にあります。別の slug にしてください。'
      : '他で更新されています。再読み込みしてください（上書きはしていません）。';
  }
  return error.message;
}

export function createSave({ state, readForm, validate, slugs, drafts, cancelDraft, updateChrome }) {
  // ---- 保存・削除 ----

  function serialize(fields, aliases) {
    return fields.kind === 'external'
      ? buildExternal(fields, state.extra)
      : buildArticle(fields, aliases, state.extra);
  }

  // slug 変更: 新 slug を作ってから旧ファイルを消す。旧ファイルの削除に失敗したら警告を返す
  async function renameSlug(fields) {
    const oldSlug = state.originalSlug;
    const oldSha = state.sha;
    // 外部記事は本文がないので aliases も付けない
    const aliases = fields.kind === 'external' ? [] : [...new Set([...state.aliases, `/posts/${oldSlug}/`])];

    // sha を付けない。同名があれば ConflictError で中止される
    const sha = await savePost(fields.slug, serialize(fields, aliases));
    state.aliases = aliases;
    state.sha = sha;

    try {
      await deletePost(oldSlug, oldSha);
      return null;
    } catch (error) {
      return `旧ファイル（${oldSlug}）を削除できませんでした。手動で削除してください。（${error.message}）`;
    }
  }

  // 新規の保存。自動の slug が既存と重なったら番号を振り直して再試行する。手入力の slug は付け直さない
  async function saveNewPost(fields, auto) {
    const attempts = auto ? AUTO_SLUG_TRIES : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (auto) {
        if (attempt > 1) state.autoNumber = slugs.randomNumber();
        fields.slug = slugs.autoSlugFor(fields);
      }
      try {
        return { slug: fields.slug, sha: await savePost(fields.slug, serialize(fields, state.aliases)) };
      } catch (error) {
        if (!auto || !(error instanceof ConflictError)) throw error;
      }
    }
    throw new Error(`自動の slug が ${AUTO_SLUG_TRIES} 回続けて既存と重なったため決められませんでした。slug を手で入力してください。`);
  }

  async function publish(event) {
    event.preventDefault();
    const fields = readForm();
    const invalid = validate(fields);
    if (invalid) {
      if (invalid.field === 'f-slug') slugs.setSlugError(invalid.message);
      showNotice('error', `入力に誤りがあります。${invalid.message}`);
      $(invalid.field).focus();
      return;
    }

    const creating = state.originalSlug === null;
    const auto = creating && state.slugAuto;
    const slugChanged = !creating && fields.slug !== state.originalSlug;
    const oldKey = draftKey(state.originalSlug);
    const oldSlug = state.originalSlug;

    $('save').disabled = true;
    cancelDraft();
    setSaveState('publishing', '公開中…');
    try {
      let warning = null;
      if (slugChanged) {
        warning = await renameSlug(fields);
      } else if (creating) {
        const saved = await saveNewPost(fields, auto);
        state.sha = saved.sha;
        $('f-slug').value = saved.slug;
      } else {
        state.sha = await savePost(fields.slug, serialize(fields, state.aliases), state.sha);
      }

      state.originalSlug = fields.slug;
      removeDraft(oldKey);
      drafts.closeDraftNotice();
      // 反映待ちの控え。slug を変えた場合は旧 slug を削除の控えにする（旧ファイルの削除に失敗していなければ）
      recordSave(fields.slug, {
        fields,
        isNew: creating || slugChanged,
        oldSlug: slugChanged ? oldSlug : null,
      });
      if (slugChanged && !warning) recordDelete(oldSlug);
      state.dirty = false;
      history.replaceState(null, '', `/edit/?slug=${encodeURIComponent(fields.slug)}`);
      updateChrome();
      renderDrafts($('drafts'));

      setSaveState('published', `公開済み ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`);
      if (warning) showNotice('error', warning);
      else showNotice('success', '公開しました。1〜2分後に反映されます。');
    } catch (error) {
      showNotice('error', errorMessage(error, creating || slugChanged));
      setSaveState('unsaved', '未保存の変更あり');
    } finally {
      $('save').disabled = false;
    }
  }

  async function removePost() {
    const slug = state.originalSlug;
    if (slug === null) return;
    const typed = prompt(`この記事を削除します。確認のため slug「${slug}」を入力してください。`);
    if (typed === null) return;
    if (typed !== slug) {
      showNotice('error', 'slug が一致しないため削除しませんでした。');
      return;
    }

    $('delete').disabled = true;
    cancelDraft();
    try {
      await deletePost(slug, state.sha);
      recordDelete(slug);
      removeDraft(draftKey(slug));
      state.dirty = false;
      location.assign('/');
    } catch (error) {
      showNotice('error', errorMessage(error, false));
      $('delete').disabled = false;
    }
  }


  return { publish, removePost };
}
