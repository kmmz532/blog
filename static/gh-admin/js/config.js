// gh-admin の設定。head.html の <meta name="gh-admin"> を読む。既定値は layouts/partials/gh-admin/settings.html にある。
// JS はこの値だけを使い、パスや URL を直接書かない。
const meta = document.querySelector('meta[name="gh-admin"]');
export const config = JSON.parse(meta?.content || '{}');

// 設定の値を正規表現に入れるときの文字のエスケープ
export const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
