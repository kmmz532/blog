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

## テーマと部品の版

見た目は Blogit の `default` テーマ（`github.com/kmmz532/blogit/themes/default`）、管理画面は `github.com/kmmz532/hugo-gh-admin` を、Hugo Modules で取り込んでいます。

- テーマは版を固定せず、ビルドのたびに Blogit の最新のコミットを利用します。
- hugo-gh-admin と hugo-shortcodes の版は、テーマ（`themes/base/go.mod`）が指定する版になります。新しい版を使うには、Blogit 側で `themes/base/go.mod` を上げます。
- 手元で `hugo` を実行すると、Hugoが `go.mod` に `require` を書き足し、`go.sum` を作ります。どちらもコミットしません。
- テーマや部品を更新した直後は、Goのモジュールのプロキシが新しい版を認識するまで数分から30分ほどかかります。その間にビルドすると古い版のままになるため、時間をおいて `blog-article` のActionsを実行し直します。
- 特定の版に固定するときは、`hugo mod get github.com/kmmz532/blogit/themes/default@<版>` を実行し、`go.mod` と `go.sum` をコミットします。

テーマや部品を手元の作業コピーで試すときは、このリポジトリの `go.mod` に一時的に `replace`（例: `replace github.com/kmmz532/blogit/themes/base => ../blogit/themes/base`）を書きます。`replace` はコミットしません。

## 3. ログインの準備

通常は、ログイン画面の「GitHubでログイン」でログインします。準備は不要です。

トークンを入力してログインする場合（権限を `blog-article` だけに絞りたい場合など）は、fine-grained PATを作ります。ログイン画面の「トークンを入力してログインする」を開いて貼ります。

1. GitHubのSettings → Developer settings → Fine-grained tokensで新しいトークンを作る。
2. Repository accessは **Only select repositories** にし、`blog-article` だけを選ぶ。
3. Permissionsは **Contents: Read and write** のみにする。
4. 有効期限は90日以内にする。

トークンは `localStorage` にだけ保存されます。リポジトリやHTMLには残りません。期限切れや失効のあとは、もう一度ログインしてください。

## 4. 動作確認

1. `/login/` の「GitHubでログイン」（またはトークンの入力）でログインする。
2. ヘッダーの「新規記事」から記事を作り、公開する。
3. 1〜2分後に `https://blog.kmmz.jp/posts/<slug>/` を開く。
