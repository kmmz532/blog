# セットアップ

## 1. リポジトリを用意する

1. `kmmz532/blog` と `kmmz532/blog-article` を作成する（どちらもpublic）。
2. `blog-article` のSettings → PagesでSourceを **GitHub Actions** にする。Custom domainは `blog.kmmz.jp`。
3. DNSに `blog.kmmz.jp` のCNAMEを追加する。
4. `blog-article` の `.github/workflows/deploy.yml` の `repository` が `kmmz532/blog` になっていることを確認する。

## 2. ローカルで起動する

前提: Hugo 0.122.0の **extended** 版。

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
