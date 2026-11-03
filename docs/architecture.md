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
- 認証: 管理者が発行したfine-grained Personal Access Token（PAT）

OAuthを利用しない理由は、GitHubのOAuthはトークン交換にclient secretが必要で、CORSにも対応していないためです。サーバーを置かずに実装できません。

## 記事の扱い

- リポジトリにある記事は公開済みです。
- 下書きはブラウザの `localStorage` だけに保存します。未公開の記事を公開リポジトリに置かないためです。
- 検索はHugoが出力する `/index.json` をブラウザで絞り込みます。索引は50件ずつのファイルに分けてあり（`/index/2.json` …）、検索は `next` をたどって読み足します。管理画面（一括管理・編集）は `/gh-admin/index.json` を確認します（検索用とは項目を分けています。`layouts/gh-admin/index.json`）。

## ファイル構成

```
blog/                           本体
├─ hugo.toml                    設定。記事はposts/ から取り込む
├─ content/                     edit / login / adminの画面（機能側）とsearchなど
├─ layouts/                     テンプレート
├─ assets/css/                  スタイル（kmmz.jpの配色を移植）
├─ assets/gh-admin/               管理画面のCSS（editor.css）
├─ static/js/                     ブラウザ側のJavaScript（本体に残すもの）
│  ├─ theme.js                    ダークモードの切り替え
│  └─ search.js                   検索
├─ static/gh-admin/js/            管理画面のJavaScript（機能側。github.jsなど）
│  ├─ github.js                   GitHub APIのラッパー（APIはこの経由でのみ呼ぶ）
│  ├─ editor.js                   編集画面の状態遷移
│  ├─ frontmatter.js              front matterの読み書き（副作用なし）
│  ├─ drafts.js                   下書きの保存と一覧
│  ├─ preview.js                  プレビューの描画と無害化
│  ├─ image.js                    画像の変換と保存
│  ├─ images.js                   画像の一覧・アップロード・削除の画面部品
│  ├─ pending.js                  反映待ちの表示。見た目の雛形はlayouts/partials/pending-templates.html
│  └─ time.js                     日本時間の計算
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
3. Hugo（0.122.0のextended）で `hugo --minify` を実行する
4. `public/` をPagesにデプロイする
