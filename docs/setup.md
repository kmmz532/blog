# セットアップ

## 1. リポジトリを用意する

1. `kmmz532/blog` と `kmmz532/blog-article` を作成する（どちらも public）。
2. `blog-article` の Settings → Pages で Source を **GitHub Actions** にする。Custom domain は `blog.kmmz.jp`。
3. DNS に `blog.kmmz.jp` の CNAME を追加する。
4. `blog-article` の `.github/workflows/deploy.yml` の `repository` が `kmmz532/blog` になっていることを確認する。

## 2. ローカルで起動する

前提: Hugo 0.122.0 の **extended** 版。

```sh
git clone <blog の URL> blog
cd blog
git clone <blog-article の URL> posts
hugo server
```

確認コマンド:

- `hugo config mounts`: `posts/content` が一覧に出ることを確認する
- `hugo --minify`: ビルドが通ることを確認する（出力は `public/`）

`posts/` は `.gitignore` に入っているので、記事のコミットは `blog-article` 側で行います。

## 3. 管理用のトークンを作る

ログイン画面に貼るのは fine-grained PAT です。

1. GitHub の Settings → Developer settings → Fine-grained tokens で新しいトークンを作る。
2. Repository access は **Only select repositories** にし、`blog-article` だけを選ぶ。
3. Permissions は **Contents: Read and write** のみにする。
4. 有効期限は 90 日以内にする。

トークンは `localStorage` にだけ保存されます。リポジトリや HTML には残りません。期限切れや失効のあとは、もう一度ログインしてください。

## 4. 動作確認

1. `/login/` でトークンを貼り、ログインする。
2. ヘッダーの「新規記事」から記事を作り、公開する。
3. 1〜2 分後に `https://blog.kmmz.jp/posts/<slug>/` を開く。
