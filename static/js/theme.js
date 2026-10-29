// 初期適用は head のインラインスクリプトが行う（ちらつき防止）。
import { setItem } from './storage.js';

const root = document.documentElement;

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const dark = !root.classList.contains('dark');
  root.classList.toggle('dark', dark);
  setItem('theme', dark ? 'dark' : 'light');
});
