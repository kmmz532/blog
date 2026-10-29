// Local preview: make sure posts/ exists, check Hugo, then start hugo server.
// Usage: npm run dev      (start server)
//        npm run check    (only check prerequisites)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// リポジトリ直下の .env があれば読む（Node 組み込み。すでにある環境変数は上書きしない）
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const articleRepo = process.env.ARTICLE_REPO ?? 'git@github.com:kmmz532/blog-article.git';
const checkOnly = process.argv.includes('--check');

const run = (cmd, args, stdio = ['ignore', 'pipe', 'inherit']) => {
  const out = execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio });
  return typeof out === 'string' ? out.trim() : '';
};

const version = run('hugo', ['version']);
if (!version.includes('+extended')) throw new Error(`Hugo extended is required: ${version}`);
const minor = Number(version.match(/v0\.(\d+)\./)?.[1] ?? 0);
if (minor < 141) throw new Error(`Hugo 0.141 or later is required: ${version}`);

if (existsSync(resolve(root, 'posts/content'))) {
  run('git', ['-C', 'posts', 'pull', '--ff-only'], 'inherit');
} else {
  run('git', ['clone', articleRepo, 'posts'], 'inherit');
}

if (checkOnly) {
  console.log(`OK: ${version.split('\n')[0]} / posts ready`);
  process.exit(0);
}

// BLOG_DEV_TOKEN があれば、localhost:1313 のページにだけメモリ上のトークンを渡す（ファイルには書かない）。
const devToken = process.env.BLOG_DEV_TOKEN;
if (devToken) {
  const allowed = 'http://localhost:1313';
  createServer((req, res) => {
    const ok = req.method === 'GET' && req.url === '/session' && req.headers.origin === allowed;
    res.writeHead(ok ? 200 : 403, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowed,
      'Cache-Control': 'no-store',
    });
    res.end(ok ? JSON.stringify({ token: devToken }) : '{}');
  }).listen(1314, '127.0.0.1');
  console.log('BLOG_DEV_TOKEN: localhost:1313 で自動ログインします。');
} else {
  console.log('BLOG_DEV_TOKEN 未設定: 自動ログインなし（/login/ で入力してください）。');
}

const server = spawn(
  'hugo',
  ['server', '--port', '1313', '--baseURL', 'http://localhost:1313/', '--disableFastRender', '--navigateToChanged'],
  { cwd: root, stdio: 'inherit' },
);
server.on('exit', (code) => process.exit(code ?? 0));
