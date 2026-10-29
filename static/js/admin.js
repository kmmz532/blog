// ログイン状態に応じて管理者向けの表示を切り替える。
// 表示制御は UX のためだけ。実際の権限は GitHub 側が判定する。
import { getToken, clearSession } from './github.js';

const loggedIn = Boolean(getToken());

for (const el of document.querySelectorAll('.admin-only')) {
  el.hidden = !loggedIn;
}

const authLink = document.getElementById('auth-link');
if (authLink) {
  if (loggedIn) {
    authLink.textContent = 'ログアウト';
    authLink.href = '#';
    authLink.addEventListener('click', (event) => {
      event.preventDefault();
      clearSession();
      location.reload();
    });
  } else {
    const ret = encodeURIComponent(location.pathname + location.search);
    authLink.href = `/login/?return=${ret}`;
  }
}
