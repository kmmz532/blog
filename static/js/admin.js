// ログイン状態に応じて管理者向けの表示を切り替える。
// 表示制御は UX のためだけ。実際の権限は GitHub 側が判定する。
import { getToken, clearSession, ensureDevSession, isLocalHost } from './github.js';
import { applyPending } from './pending.js';

await ensureDevSession();

const loggedIn = Boolean(getToken());

// ローカル開発では localStorage が本番と別になるので、管理ボタンは常に出す（編集画面は未ログインならログインへ飛ぶ）
for (const el of document.querySelectorAll('.admin-only')) {
  el.hidden = !(loggedIn || isLocalHost);
}
for (const el of document.querySelectorAll('.guest-only')) {
  el.hidden = loggedIn;
  if (el.tagName === 'A') {
    el.href = `/login/?return=${encodeURIComponent(location.pathname + location.search)}`;
  }
}

function logout(event) {
  event.preventDefault();
  clearSession();
  location.reload();
}

for (const el of document.querySelectorAll('.logout-only')) {
  el.hidden = !loggedIn;
  el.addEventListener('click', logout);
}

const authLink = document.getElementById('auth-link');
if (authLink) {
  if (loggedIn) {
    authLink.textContent = 'ログアウト';
    authLink.href = '#';
    authLink.addEventListener('click', logout);
  } else {
    const ret = encodeURIComponent(location.pathname + location.search);
    authLink.href = `/login/?return=${ret}`;
  }
}

// 公開・削除の直後の反映待ち表示（ログインしている端末だけ）
applyPending();
