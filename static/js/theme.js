// 初期適用は head のインラインスクリプトが行う（ちらつき防止）。
// 他の JS（storage.js など機能側）を読まない。保存は自分で try/catch する。
const root = document.documentElement;

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const dark = !root.classList.contains('dark');
  root.classList.toggle('dark', dark);
  try {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  } catch {
    // 保存できなくても切り替えは効く（次に開いたときだけ戻る）
  }
});
