// Local preview: make sure posts/ exists, check Hugo, then start hugo server.
// Usage: npm run dev      (start server)
//        npm run check    (only check prerequisites)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

const server = spawn(
  'hugo',
  ['server', '--port', '1313', '--baseURL', 'http://localhost:1313/', '--disableFastRender', '--navigateToChanged'],
  { cwd: root, stdio: 'inherit' },
);
server.on('exit', (code) => process.exit(code ?? 0));
