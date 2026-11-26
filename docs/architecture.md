# 構成

サーバーは使いません。閲覧はGitHub Pagesの静的HTML、編集はブラウザからGitHub APIを直接呼びます。

```
[閲覧者]  → blog.kmmz.jp（GitHub Pages、Hugoで生成した静的HTML）
[管理者]  → 同じページのJavaScript → api.github.com（Contents APIで直接コミット）
                                   → blog-articleにpush
                                   → ActionsがHugoでビルドしてPagesに配信
```

## 使っている技術

- 静的サイトジェネレーター: Hugo
- ホスティング: GitHub Pages
- フロントエンド: 素のES Modules（ビルドなし）。依存はCDNの `marked`（プレビュー）だけ
- 認証: 「GitHubでログイン」（GitHubのOAuth）。予備として、fine-grained Personal Access Token（PAT）の入力も使える

GitHubのOAuthは、トークンの交換にclient secretが必要で、CORSにも対応していません。そのため、[Blogit](https://github.com/kmmz532/blogit) のOAuth Appと認証用Worker（client secretを持つ）を共用しています。ログインの流れは次のとおりです。

1. ログイン画面の「GitHubでログイン」から、GitHubの許可画面を開く
2. GitHubは、OAuth Appのコールバック URL にある中継ページ（`https://blogit.kmmz.jp/oauth/`）にコードを渡す
3. 中継ページが、コードをこのサイトのログイン画面に戻す
4. ログイン画面が、BlogitのWorker（`/github/token`）でコードをトークンに交換する

設定は `hugo.toml` の `params.ghAdmin` の `oauthClientID`・`oauthTokenURL`・`oauthRelayURL` です。

## 記事の扱い

- リポジトリにある記事は公開済みです。
- 下書きはブラウザの `localStorage` だけに保存します。未公開の記事を公開リポジトリに置かないためです。
- 検索はHugoが出力する `/index.json` をブラウザで絞り込みます。索引は50件ずつのファイルに分けてあり（`/index/2.json` …）、検索は `next` をたどって読み足します。管理画面（一括管理・編集）は `/gh-admin/index.json` を確認します（検索用とは項目を分けています。hugo-gh-adminの `layouts/gh-admin/index.json`）。

## ファイル構成

見た目とレイアウト（テンプレート・CSS・検索などのJavaScript）は、[Blogit](https://github.com/kmmz532/blogit) の `default` テーマ（`github.com/kmmz532/blogit/themes/default`）を Hugo Modules で取り込みます。`default` テーマは、このブログの見た目をもとにしたものです。管理画面の機能（ログイン・編集・一括管理・画像の管理）の部品 `github.com/kmmz532/hugo-gh-admin` と、記事の書式の部品 `github.com/kmmz532/hugo-shortcodes` も、テーマ経由で取り込みます。

このリポジトリに置くのは、このブログ固有のものだけです。テーマの同じパスにファイルを置くと上書きできます（例: `layouts/partials/sidebar.html`）。

```
blog/                           本体
├─ hugo.toml                    設定。記事はposts/ から取り込む
├─ i18n/ja.toml                 テーマの文言の上書き（404の文言）
├─ static/                      ファビコン・既定のサムネイル・CNAME
├─ scripts/                     手元での起動（dev.mjs）とビルド結果の比較（diff-build.mjs）
└─ posts/                       blog-articleのclone（Git管理外）

blog-article/                   記事と画像
├─ content/posts/<slug>.md
├─ static/images/<yyyy>/        画像（画像挿入時に作られる）
└─ .github/workflows/deploy.yml
```

## デプロイ

`blog-article` のpushで `.github/workflows/deploy.yml` が動きます。手順は次のとおりです。

1. 本体（`kmmz532/blog`）を作業ディレクトリに取得する
2. `blog-article` を `posts/` に取得する
3. Hugo（0.169.0のextended）で `hugo --minify` を実行する
4. `public/` をPagesにデプロイする
