# 構成

サーバーは使いません。閲覧は GitHub Pages の静的 HTML、編集はブラウザから GitHub API を直接呼びます。

```
[閲覧者]  → blog.kmmz.jp（GitHub Pages、Hugo で生成した静的 HTML）
[管理者]  → 同じページの JavaScript → api.github.com（Contents API で直接コミット）
                                   → blog-article に push
                                   → Actions が Hugo でビルドして Pages に配信
```

## 使っている技術

- 静的サイトジェネレーター: Hugo
- ホスティング: GitHub Pages
- フロントエンド: 素の ES Modules（ビルドなし）。依存は CDN の `marked`（プレビュー）だけ
- 認証: 管理者が発行した fine-grained Personal Access Token（PAT）

OAuth を使わない理由は、GitHub の OAuth はトークン交換に client secret が必要で、CORS にも対応していないためです。サーバーを置かずに実装できません。

## 記事の扱い

- リポジトリにある記事は公開済みです。
- 下書きはブラウザの `localStorage` だけに保存します。未公開の記事を公開リポジトリに置かないためです。
- 検索は Hugo が出力する `/index.json` をブラウザで絞り込みます。

## ファイル構成

```
blog/                           本体
├─ hugo.toml                    設定。記事は posts/ から取り込む
├─ content/                     edit / login / search の各ページ
├─ layouts/                     テンプレート
├─ assets/css/                  スタイル（kmmz.jp の配色を移植）
├─ static/js/                   ブラウザ側の JavaScript
│  ├─ github.js                 GitHub API のラッパー（API はこの経由でのみ呼ぶ）
│  ├─ editor.js                 編集画面の状態遷移
│  ├─ frontmatter.js            front matter の読み書き（副作用なし）
│  ├─ drafts.js                 下書きの保存と一覧
│  ├─ preview.js                プレビューの描画と無害化
│  ├─ image.js                  画像の変換と保存
│  ├─ images.js                 画像の一覧・アップロード・削除の画面部品
│  ├─ storage.js                localStorage の例外処理をまとめたもの
│  └─ time.js                   日本時間の計算
└─ posts/                       blog-article の clone（Git 管理外）

blog-article/                   記事と画像
├─ content/posts/<slug>.md
├─ static/images/<yyyy>/        画像（画像挿入時に作られる）
└─ .github/workflows/deploy.yml
```

## デプロイ

`blog-article` の push で `.github/workflows/deploy.yml` が動きます。手順は次のとおりです。

1. 本体（`kmmz532/blog`）を作業ディレクトリに取得する
2. `blog-article` を `posts/` に取得する
3. Hugo（0.122.0 の extended）で `hugo --minify` を実行する
4. `public/` を Pages にデプロイする
