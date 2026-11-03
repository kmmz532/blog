# セットアップ

## 1. リポジトリを用意する

1. `kmmz532/blog` と `kmmz532/blog-article` を作成する（どちらもpublic）。
2. `blog-article` のSettings → PagesでSourceを **GitHub Actions** にする。Custom domainは `blog.kmmz.jp`。
3. DNSに `blog.kmmz.jp` のCNAMEを追加する。
4. `blog-article` の `.github/workflows/deploy.yml` の `repository` が `kmmz532/blog` になっていることを確認する。

## 2. ローカルで起動する

前提: Hugo 0.141.0以上の **extended** 版と、Go（Hugo Modules の取り込みに利用する）。

```sh
git clone <blogのURL> blog
cd blog
git clone <blog-articleのURL> posts
hugo server
```

確認コマンド:

- `hugo config mounts`: `posts/content` が一覧に出ることを確認する
- `hugo --minify`: ビルドが通ることを確認する（出力は `public/`）

`posts/` は `.gitignore` に入っているので、記事のコミットは `blog-article` 側で行います。

## 管理画面の部品を手元で直す

管理画面の機能は Hugo Modules の部品 `github.com/kmmz532/hugo-gh-admin` として取り込んでいます。版は `go.mod` に記録されています。

手元の作業コピーを利用するには、`BLOG_ADMIN_DIR` に作業コピーのパスを指定して `npm run dev` を起動します。`scripts/dev.mjs` が `HUGO_MODULE_REPLACEMENTS` を設定します。

```sh
BLOG_ADMIN_DIR=F:\workspace\kmmz1127\hugo-gh-admin npm run dev
```

版を上げるとき、または戻すときは次の手順で行います。

1. `hugo mod get github.com/kmmz532/hugo-gh-admin@vX.Y.Z` を実行する（戻すときは前の版を指定する）。
2. `git diff go.mod go.sum` と、部品の `CHANGELOG.md` の差分を確認する。
3. `npm run build` と `hugo config mounts` が通ることを確認し、`go.mod` と `go.sum` をコミットする。

## 3. 管理用のトークンを作る

ログイン画面に貼るのはfine-grained PATです。

1. GitHubのSettings → Developer settings → Fine-grained tokensで新しいトークンを作る。
2. Repository accessは **Only select repositories** にし、`blog-article` だけを選ぶ。
3. Permissionsは **Contents: Read and write** のみにする。
4. 有効期限は90日以内にする。

トークンは `localStorage` にだけ保存されます。リポジトリやHTMLには残りません。期限切れや失効のあとは、もう一度ログインしてください。

## 4. 動作確認

1. `/login/` でトークンを貼り、ログインする。
2. ヘッダーの「新規記事」から記事を作り、公開する。
3. 1〜2分後に `https://blog.kmmz.jp/posts/<slug>/` を開く。
