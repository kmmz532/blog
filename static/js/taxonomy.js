// カテゴリとタグ（design.md §11.6・§16）。カテゴリは階層を親から順に選ぶ、タグは複数選ぶ。どちらも「新規」で作れる。
// 画面の状態（state）と、変更を知らせる関数（markDirty）は引数で受け取る。editor.js は import しない
import { showNotice } from './notice.js';

const $ = (id) => document.getElementById(id);

// ボタンを 1 つ作る。class は choice、aria-pressed で選択中かを示す
function choice(text, pressed, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'choice';
  button.textContent = text;
  button.setAttribute('aria-pressed', String(pressed));
  button.addEventListener('click', onClick);
  return button;
}

export function createTaxonomy({ state, markDirty }) {
  // ---- カテゴリ（階層。親から順に選ぶ。design.md §16） ----

  // 今の階層の子の候補。件数の多い順
  function childrenOf(prefix) {
    return state.categoryNodes
      .filter((node) => node.path.length === prefix.length + 1 && prefix.every((name, i) => node.path[i] === name))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  // 階層の段ごとに、同じ段の候補（兄弟）を 1 行ずつ並べる。選んでいる段は押された状態で出す。
  // 別の候補を押すと、その段から下を選び直す（design.md §16）
  function renderCategories() {
    const path = state.categories;
    const box = $('category-chips');
    const rows = [];
    for (let depth = 0; depth <= path.length; depth++) {
      const prefix = path.slice(0, depth);
      const current = path[depth];
      const options = childrenOf(prefix);
      // 保存前の新しい名前や、候補の読み込み前の名前も、選んでいるものとして出す
      if (current !== undefined && !options.some((node) => node.name === current)) {
        options.unshift({ name: current });
      }
      if (!options.length) continue;
      const row = document.createElement('div');
      row.className = 'category-row';
      row.append(
        ...options.map((node) =>
          choice(node.name, node.name === current, () => {
            // 選んでいるものをもう一度押すと、その段から下を外す（上の段は残る）
            state.categories = node.name === current ? prefix : [...prefix, node.name];
            state.categoryPicked = true;
            renderCategories();
            markDirty();
          }),
        ),
      );
      rows.push(row);
    }
    const add = choice('＋ 新規', false, () => {
      $('category-new').hidden = false;
      $('f-category-new').focus();
    });
    rows.push(add);
    box.replaceChildren(...rows);
  }

  // 「＋ 新規」は今の階層の子として作る（同じ名前が子にあれば、それを使う）
  function commitNewCategory() {
    const name = $('f-category-new').value.trim();
    $('f-category-new').value = '';
    $('category-new').hidden = true;
    if (!name) return;
    if (name.includes(',')) {
      showNotice('error', 'カテゴリ名に , は使えません。');
      return;
    }
    const existing = childrenOf(state.categories).find((node) => node.name.toLowerCase() === name.toLowerCase());
    state.categories = [...state.categories, existing?.name ?? name];
    state.categoryPicked = true;
    renderCategories();
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

  // 既存の記事から、カテゴリの階層とタグの件数を集計する。失敗しても手入力は続けられる
  async function loadIndex() {
    try {
      const res = await fetch($('post-form').dataset.indexUrl, { cache: 'no-store' });
      if (!res.ok) return;
      const posts = await res.json();
      // 階層の各段（先頭から k 段目まで）を 1 つの節として数える
      const nodes = new Map();
      const tagCounts = new Map();
      for (const post of posts) {
        const path = post.categories ?? [];
        for (let k = 1; k <= path.length; k++) {
          const prefix = path.slice(0, k);
          const key = JSON.stringify(prefix);
          const node = nodes.get(key) ?? { path: prefix, name: prefix.at(-1), count: 0 };
          node.count += 1;
          nodes.set(key, node);
        }
        for (const tag of post.tags ?? []) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
      state.categoryNodes = [...nodes.values()];
      const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
      state.knownTags = [...tagCounts].map(([name, count]) => ({ name, count })).sort(byCount);
      // 新規記事は件数が一番多い最上位のカテゴリを初期値にする（既存が無ければ tech）
      const keepCurrent = state.originalSlug !== null || state.categoryPicked;
      if (!keepCurrent) state.categories = [childrenOf([])[0]?.name ?? 'tech'];
      renderCategories();
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

  return { renderCategories, renderSelectedTags, renderTagSuggestions, loadIndex, attach };
}
