// /admin/images/ の画像の管理
import { config } from './config.js';
import { ensureDevSession, getToken } from './github.js';
import { mountImageManager } from './images.js';

await ensureDevSession();
if (getToken()) {
  mountImageManager(document.getElementById('image-manager')).load();
} else {
  location.replace(`${config.loginURL}?return=${encodeURIComponent(location.pathname + location.search)}`);
}
