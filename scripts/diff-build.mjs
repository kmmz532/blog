// Compare the Hugo build output with a saved baseline (design.md §15).
// Usage: npm run diff-build                    (compare; the baseline is made on the first run)
//        node scripts/diff-build.mjs --reset   (replace the baseline with the current build)
// The output goes to .diff-build/ (not in git). Exit code 1 means the build output changed.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, '.diff-build');
const baselineDir = join(outDir, 'baseline');
const currentDir = join(outDir, 'current');
const reset = process.argv.includes('--reset');
const TEXT_EXT = /\.(html|xml|json|css|js|txt|md)$/;
const MAX_LINES_PER_FILE = 20;

// 毎回変わる値は比較の前に固定する（ビルド時刻と、CSS の fingerprint とその integrity）。
// Hugo の minify は属性の引用符を省くことがあるので、引用符の有無は両方受ける
const VOLATILE = [
  [/(<meta name="?build-time"? content="?)\d+/g, '$1BUILD'],
  [/\.min\.[0-9a-f]{64}\.css/g, '.min.FINGERPRINT.css'],
  [/integrity="?sha256-[^"\s>]*"?/g, 'integrity="INTEGRITY"'],
];

// 1 行に詰められた HTML を、タグごとに改行して比べられるようにする
function normalize(text) {
  return VOLATILE.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text).replace(/></g, '>\n<');
}

// 行の差分。先頭と末尾の一致は飛ばし、間を LCS で比べる（出力は「行番号: - 旧」「行番号: + 新」）
function diffLines(left, right) {
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let endL = left.length;
  let endR = right.length;
  while (endL > start && endR > start && left[endL - 1] === right[endR - 1]) {
    endL--;
    endR--;
  }
  const a = left.slice(start, endL);
  const b = right.slice(start, endR);
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  let leftNo = start + 1;
  let rightNo = start + 1;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
      leftNo++;
      rightNo++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      out.push(`  ${rightNo}: + ${b[j]}`);
      j++;
      rightNo++;
    } else {
      out.push(`  ${leftNo}: - ${a[i]}`);
      i++;
      leftNo++;
    }
  }
  return out;
}

function listFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(relative(dir, path).split('\\').join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return files.sort();
}

// 出力先を空にしてから作る。古いファイルが混ざらないように
function build() {
  rmSync(currentDir, { recursive: true, force: true });
  execFileSync('hugo', ['--minify', '-d', currentDir], { cwd: root, stdio: 'inherit' });
}

function compareFile(rel) {
  const a = readFileSync(join(baselineDir, rel));
  const b = readFileSync(join(currentDir, rel));
  if (!TEXT_EXT.test(rel)) return a.equals(b) ? [] : ['（バイナリが変わりました）'];
  return diffLines(normalize(a.toString('utf8')).split('\n'), normalize(b.toString('utf8')).split('\n'));
}

build();

if (reset || !existsSync(baselineDir)) {
  rmSync(baselineDir, { recursive: true, force: true });
  cpSync(currentDir, baselineDir, { recursive: true });
  console.log(`基準を保存しました: ${relative(root, baselineDir)}（${listFiles(baselineDir).length} ファイル）`);
  process.exit(0);
}

const baseFiles = listFiles(baselineDir);
const curFiles = listFiles(currentDir);
const all = [...new Set([...baseFiles, ...curFiles])].sort();
let changed = 0;

for (const rel of all) {
  if (!baseFiles.includes(rel)) {
    console.log(`追加: ${rel}`);
    changed++;
    continue;
  }
  if (!curFiles.includes(rel)) {
    console.log(`削除: ${rel}`);
    changed++;
    continue;
  }
  const diffs = compareFile(rel);
  if (diffs.length === 0) continue;
  changed++;
  console.log(`変更: ${rel}（${diffs.length} 行）`);
  for (const line of diffs.slice(0, MAX_LINES_PER_FILE)) console.log(line);
  if (diffs.length > MAX_LINES_PER_FILE) console.log(`  …ほか ${diffs.length - MAX_LINES_PER_FILE} 行`);
}

if (changed === 0) {
  console.log(`差分 0（${all.length} ファイル）`);
} else {
  console.log(`差分のあるファイル: ${changed}（比較したファイル ${all.length}）`);
  process.exitCode = 1;
}
