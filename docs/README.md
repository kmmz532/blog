# blog.kmmz.jp ドキュメント

個人ブログ blog.kmmz.jp のソースに関するドキュメントです。

- [architecture.md](architecture.md): 構成と動作の仕組み
- [setup.md](setup.md): リポジトリの作成、ローカルでの起動、GitHub の設定
- [writing.md](writing.md): 記事の書き方と管理画面の使い方
- [security.md](security.md): トークンと権限の扱い

## リポジトリ

| リポジトリ | 内容 |
| --- | --- |
| `kmmz532/blog` | 本体。レイアウト、CSS、JavaScript、設定 |
| `kmmz532/blog-article` | 記事（Markdown）と画像。Pages の配信元 |

本体を変えたら、`blog-article` の Actions を手動で実行して反映します。
