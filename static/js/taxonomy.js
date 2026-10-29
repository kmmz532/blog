// カテゴリとタグ（design.md §11.6）。カテゴリは既存から 1 つ選ぶ、タグは複数選ぶ。どちらも「新規」で作れる。
// 画面の状態（state）と、変更を知らせる関数（markDirty）は引数で受け取る。editor.js は import しない
import { showNotice } from './notice.js';

const $ = (id) => document.getElementById(id);

export function createTaxonomy({ state, markDirty }) {
  // ---- カテゴリ（既存から 1 つ選ぶ。「＋ 新規」で作る） ----

  function currentCategory() {
    return $('category-chips').querySelector('[aria-pressed="true"]')?.dataset.value ?? 'tech';
  }

  function renderCategories(selected) {
    const names = state.knownCategories.map((item) => item.name);
    if (selected && !names.includes(selected)) names.push(selected);
    const box = $('category-chips');
    box.replaceChildren(
      ...names.map((name) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'choice';
        button.dataset.value = name;
        button.textContent = name;
        button.setAttribute('aria-pressed', String(name === selected));
        button.addEventListener('click', () => {
          state.categoryPicked = true;
          renderCategories(name);
          markDirty();
        });
        return button;
      }),
    );
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'choice';
    add.textContent = '＋ 新規';
    add.addEventListener('click', () => {
      $('category-new').hidden = false;
      $('f-category-new').focus();
    });
    box.append(add);
  }

  function commitNewCategory() {
    const name = $('f-category-new').value.trim();
    $('f-category-new').value = '';
    $('category-new').hidden = true;
    if (!name) return;
    if (name.includes(',')) {
      showNotice('error', 'カテゴリ名に , は使えません。');
      return;
    }
    const existing = state.knownCategories.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!existing) state.knownCategories.push({ name, count: 0 });
    state.categoryPicked = true;
    renderCategories(existing?.name ?? name);
    markDirty();
  }

  // ---- タグ（選択中のタグと、既存タグの候補） ----

  // 大文字小文字だけ違うときは既存のほうを使う
  function normalizeTagName(raw) {
    const name = raw.trim().replace(/^#/, '');
    if (!name || name.includes(',')) return null;
    const existing = state.knownTags.find((item) => item.name.toLowerCase() === name.toLowerCase());
    return existing?.name ?? name;
  }

  function renderSelectedTags() {
    const box = $('tag-selected');
    box.replaceChildren(
      ...state.tags.map((tag, index) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = `#${tag}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.setAttribute('aria-label', `${tag} を外す`);
        remove.textContent = '×';
        remove.addEventListener('click', () => {
          state.tags.splice(index, 1);
          renderSelectedTags();
          renderTagSuggestions($('f-tag-entry').value);
          markDirty();
        });
        chip.append(remove);
        return chip;
      }),
    );
  }

  // 入力が空なら件数の多い 20 件、文字を打ったら全件から入力文字を含むものを出す。押すと選択・解除
  function renderTagSuggestions(filter) {
    const needle = filter.trim().toLowerCase();
    const box = $('tag-suggest');
    const matches = needle
      ? state.knownTags.filter((item) => item.name.toLowerCase().includes(needle))
      : state.knownTags.slice(0, 20);
    box.replaceChildren(
      ...matches.map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'choice';
        button.textContent = `#${item.name} (${item.count})`;
        button.setAttribute('aria-pressed', String(state.tags.includes(item.name)));
        button.addEventListener('click', () => {
          if (state.tags.includes(item.name)) state.tags = state.tags.filter((tag) => tag !== item.name);
          else state.tags.push(item.name);
          renderSelectedTags();
          renderTagSuggestions($('f-tag-entry').value);
          markDirty();
        });
        return button;
      }),
    );
  }

  function addTagFromEntry() {
    const entry = $('f-tag-entry');
    const raw = entry.value;
    const name = normalizeTagName(raw);
    entry.value = '';
    if (name === null) {
      if (raw.trim()) showNotice('error', 'タグ名に , は使えません。');
      return;
    }
    if (!state.tags.includes(name)) {
      state.tags.push(name);
      renderSelectedTags();
      markDirty();
    }
    renderTagSuggestions('');
  }

  function attachTagInput() {
    const entry = $('f-tag-entry');
    entry.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addTagFromEntry();
      } else if (event.key === 'Backspace' && entry.value === '' && state.tags.length) {
        state.tags.pop();
        renderSelectedTags();
        renderTagSuggestions('');
        markDirty();
      }
    });
    entry.addEventListener('input', () => renderTagSuggestions(entry.value));
    entry.addEventListener('blur', () => {
      if (entry.value.trim()) addTagFromEntry();
    });
  }

  // 既存の記事から、カテゴリとタグの件数を集計する。失敗しても手入力は続けられる
  async function loadIndex() {
    try {
      const res = await fetch($('post-form').dataset.indexUrl, { cache: 'no-store' });
      if (!res.ok) return;
      const posts = await res.json();
      const categoryCounts = new Map();
      const tagCounts = new Map();
      for (const post of posts) {
        for (const category of post.categories ?? []) {
          categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
        }
        for (const tag of post.tags ?? []) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
      const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
      state.knownCategories = [...categoryCounts].map(([name, count]) => ({ name, count })).sort(byCount);
      state.knownTags = [...tagCounts].map(([name, count]) => ({ name, count })).sort(byCount);
      // 新規記事は件数が一番多いカテゴリを初期値にする（既存が無ければ tech）
      const keepCurrent = state.originalSlug !== null || state.categoryPicked;
      renderCategories(keepCurrent ? currentCategory() : (state.knownCategories[0]?.name ?? 'tech'));
      renderTagSuggestions($('f-tag-entry').value);
    } catch {
      // 一覧が出なくても、新規に入力すれば使える
    }
  }

  // カテゴリの「新規」とタグの入力欄の操作を付ける
  function attach() {
    $('f-category-new').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitNewCategory();
      }
    });
    $('f-category-new').addEventListener('blur', commitNewCategory);
    attachTagInput();
  }

  return { currentCategory, renderCategories, renderSelectedTags, renderTagSuggestions, loadIndex, attach };
}
