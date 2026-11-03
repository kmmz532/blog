import { checkRepoPush, fetchLogin, saveSession, repo } from './github.js';

const form = document.getElementById('login-form');
const tokenInput = document.getElementById('token');
const status = document.getElementById('login-status');

// 同一 origin のパスだけ戻り先として許可する
function returnPath() {
  const ret = new URLSearchParams(location.search).get('return') ?? '/';
  return ret.startsWith('/') && !ret.startsWith('//') ? ret : '/';
}

function showError(message) {
  status.textContent = message;
  status.classList.add('error');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = '確認しています…';
  status.classList.remove('error');

  try {
    if (!(await checkRepoPush(token))) {
      showError(`このトークンでは ${repo} に書き込めません。権限の設定を確認してください。`);
      return;
    }
    const login = await fetchLogin(token);
    saveSession(token, login);
    location.replace(returnPath());
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
  }
});
