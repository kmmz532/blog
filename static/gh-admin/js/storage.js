// localStorage はプライベートモードや設定で使えないことがあるので、例外を出さずに扱う。
export function getItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// 書けなければ false。表示に出すかどうかは呼び出し側が決める
export function setItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // 消せなくても致命的ではない
  }
}

export function keys() {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
  }
}
