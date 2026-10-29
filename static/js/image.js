import { saveImage, rawImageUrl, ConflictError } from './github.js';
import { jstYear } from './time.js';

const MAX_LONG_SIDE = 1600;
const MAX_BYTES = 1024 * 1024;
const QUALITY = 0.85;
// 変換すると劣化・非互換になるので素通しする（サイズ上限のみ適用）
const PASS_THROUGH = new Set(['image/gif', 'image/svg+xml']);
const EXT = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};
const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomName() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => NAME_CHARS[byte % NAME_CHARS.length]).join('');
}

async function toWebp(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('画像を変換できませんでした。'))),
      'image/webp',
      QUALITY,
    );
  });
}

// 保存する Blob と拡張子を決める。サイズ超過と未対応形式はここで弾く
export async function prepareImage(file) {
  if (!file.type.startsWith('image/')) {
    throw new Error('画像ファイルを選んでください。');
  }
  const blob = PASS_THROUGH.has(file.type) ? file : await toWebp(file);
  const ext = EXT[blob.type];
  if (!ext) throw new Error(`この形式は保存できません（${blob.type}）。`);
  if (blob.size > MAX_BYTES) {
    const mb = (blob.size / 1024 / 1024).toFixed(1);
    throw new Error(`サイズが 1MB を超えています（${mb}MB）。小さい画像を選んでください。`);
  }
  return { blob, ext };
}

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  // 大きな配列を一度に展開すると引数の上限に当たるので分割する
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

// 上げたばかりの画像は、公開されるまで /images/... で見られない。この画面の間だけ手元の Blob で見せる
const localImages = new Map();

// 記事内の画像 URL（/images/...）を、今すぐ見られる URL にする。それ以外はそのまま返す
export function imageSrc(url) {
  if (!/^\/images\/\d{4}\/[a-z0-9]{8}\.\w+$/.test(url)) return url;
  return localImages.get(url) ?? rawImageUrl(url);
}

// 保存した画像の公開パス（/images/<yyyy>/<name>）を返す
export async function uploadImage(file) {
  const { blob, ext } = await prepareImage(file);
  const content = await toBase64(blob);
  const year = jstYear();

  // 名前の衝突は確率的にほぼ起きないが、起きたら 1 回だけ付け直す
  for (let attempt = 0; attempt < 2; attempt++) {
    const name = `${randomName()}.${ext}`;
    try {
      await saveImage(`static/images/${year}/${name}`, content);
      localImages.set(`/images/${year}/${name}`, URL.createObjectURL(blob));
      return `/images/${year}/${name}`;
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
    }
  }
  throw new Error('画像の保存名が重複しました。もう一度お試しください。');
}
