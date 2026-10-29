// 他の JS は GitHub API をこのモジュール経由でのみ呼ぶ。
import { getItem, setItem, removeItem } from './storage.js';

const API_ORIGIN = 'https://api.github.com';
const TOKEN_KEY = 'blog_token';
const LOGIN_KEY = 'blog_login';
const SLUG_RE = /^[a-z0-9-]{1,80}$/;
// 画像は blog-article の static/images/<yyyy>/<8文字>.<ext> に置く
const IMAGE_PATH_RE = /^static\/images\/\d{4}\/[a-z0-9]{8}\.(webp|png|jpg|gif|svg)$/;

export const repo = document.querySelector('meta[name="blog-repo"]')?.content ?? '';
export const branch = document.querySelector('meta[name="blog-branch"]')?.content ?? '';

export class ConflictError extends Error {}

export const getToken = () => getItem(TOKEN_KEY);
export const getLogin = () => getItem(LOGIN_KEY);

export function saveSession(token, login) {
  if (!(setItem(TOKEN_KEY, token) && setItem(LOGIN_KEY, login))) {
    throw new Error('ブラウザの保存領域に書き込めません。');
  }
}

export function clearSession() {
  removeItem(TOKEN_KEY);
  removeItem(LOGIN_KEY);
}

// npm run dev が BLOG_DEV_TOKEN を渡されているときだけ、localhost でトークンを受け取って保存する。
// 本番のドメインでは何もしない。取れなければ通常どおりログイン画面を使う。
const DEV_SESSION_URL = 'http://127.0.0.1:1314/session';
export const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

export async function ensureDevSession() {
  if (!isLocalHost || getToken()) return;
  try {
    const res = await fetch(DEV_SESSION_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const { token } = await res.json();
    if (token) saveSession(token, await fetchLogin(token));
  } catch {
    // dev サーバーが無い・トークンが不正なときは、手動ログインに任せる
  }
}

export const isValidSlug = (slug) => SLUG_RE.test(slug);

function postPath(slug) {
  if (!isValidSlug(slug)) {
    throw new Error('slug は英小文字・数字・ハイフンのみ（1〜80 文字）で指定してください。');
  }
  return `content/posts/${slug}.md`;
}

// btoa / atob 単体は日本語で壊れるので UTF-8 バイト列を経由する
function toBase64(text) {
  let bin = '';
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function redirectToLogin() {
  const ret = encodeURIComponent(location.pathname + location.search);
  location.href = `/login/?return=${ret}`;
}

// token を省略すると保存済みトークンを使う（ログイン時だけ明示的に渡す）。
// GET の 404 は null を返す。
async function api(endpoint, { method = 'GET', body, token = getToken() } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_ORIGIN}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  // 失効した保存済みトークンは捨ててログインし直してもらう。
  // ログイン画面で入力中のトークンが弾かれたときは呼び出し側にエラーを返す。
  if (res.status === 401 && token === getToken()) {
    clearSession();
    redirectToLogin();
    throw new Error('ログインの有効期限が切れました。');
  }
  if (res.status === 409 || res.status === 422) {
    throw new ConflictError(`GitHub がこの操作を受け付けませんでした（${res.status}）。`);
  }
  if (res.status === 404 && method === 'GET') return null;

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GitHub API エラー（${res.status}）: ${json.message ?? ''}`.trim());
  }
  return json;
}

function contentsUrl(path) {
  return `/repos/${repo}/contents/${path}`;
}

// 存在しなければ null
export async function getPost(slug) {
  const json = await api(`${contentsUrl(postPath(slug))}?ref=${encodeURIComponent(branch)}`);
  if (!json) return null;
  return { sha: json.sha, text: fromBase64(json.content) };
}

// sha を省略すると新規作成。既存ファイルがあれば ConflictError。新しい sha を返す
export async function savePost(slug, text, sha) {
  const json = await api(contentsUrl(postPath(slug)), {
    method: 'PUT',
    body: {
      message: `post: ${slug}`,
      content: toBase64(text),
      branch,
      ...(sha ? { sha } : {}),
    },
  });
  return json.content.sha;
}

export async function deletePost(slug, sha) {
  await api(contentsUrl(postPath(slug)), {
    method: 'DELETE',
    body: { message: `delete: ${slug}`, sha, branch },
  });
}

// 複数の記事を 1 コミットにまとめる（design.md §17）。changes は { slug: text | null }（null は削除）。
// 参照（ブランチ）が他で進んでいたら ConflictError。強制更新はしないので、失敗時は何も変わらない
export async function commitChanges(changes, message) {
  const ref = await api(`/repos/${repo}/git/ref/heads/${branch}`);
  const headSha = ref.object.sha;
  const head = await api(`/repos/${repo}/git/commits/${headSha}`);

  const entries = [];
  for (const [slug, text] of Object.entries(changes)) {
    const path = postPath(slug);
    if (text === null) {
      entries.push({ path, mode: '100644', type: 'blob', sha: null });
    } else {
      const blob = await api(`/repos/${repo}/git/blobs`, { method: 'POST', body: { content: text, encoding: 'utf-8' } });
      entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
  }
  const tree = await api(`/repos/${repo}/git/trees`, {
    method: 'POST',
    body: { base_tree: head.tree.sha, tree: entries },
  });
  const commit = await api(`/repos/${repo}/git/commits`, {
    method: 'POST',
    body: { message, tree: tree.sha, parents: [headSha] },
  });
  await api(`/repos/${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: commit.sha } });
  return commit.sha;
}

// base64 は呼び出し側で作る（バイナリを扱うため）。既存パスは ConflictError
export async function saveImage(path, base64) {
  if (!IMAGE_PATH_RE.test(path)) throw new Error('画像の保存先が正しくありません。');
  await api(contentsUrl(path), {
    method: 'PUT',
    body: { message: `image: ${path}`, content: base64, branch },
  });
}

// ログイン時に使う。書き込み権限の確認はここで行う
export async function checkRepoPush(token) {
  const json = await api(`/repos/${repo}`, { token });
  return json?.permissions?.push === true;
}

export async function fetchLogin(token) {
  const json = await api('/user', { token });
  if (!json) throw new Error('ユーザー情報を取得できませんでした。');
  return json.login;
}
