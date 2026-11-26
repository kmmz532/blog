# セキュリティ

利用者は管理者1人です。対策は最小限にしています。

## 権限

- 書き込みの権限はGitHubが判定します。このサイトに独自の認可処理はありません。
- 「GitHubでログイン」で受け取るトークンは、OAuthの `repo` スコープです。ログインしたアカウントの全リポジトリに書き込めます。権限を `blog-article` だけに絞りたいときは、Contents（読み書き）だけのfine-grained PATでログインします。
- トークンの交換は、BlogitのWorkerを経由します。Workerはトークンを保存も記録もしません。
- 画面の「管理者向けの表示」は使い勝手のためだけです。実際の権限はGitHub側で決まります。

## トークン

- `localStorage` にだけ保存します。リポジトリ、HTML、URL、ログには出しません。
- GitHubが401を返したら、保存済みのトークンを消してログイン画面へ戻します。
- ログアウトはトークンを消すだけです。GitHub側のトークンは、利用者がGitHubの設定から失効させてください。

## ブラウザでの扱い

- 外部スクリプトは `marked` だけです。バージョンを固定し、SRI（`integrity`）を付けています。
- Content-Security-Policyで、スクリプトの読み込み元を `self`・Xの埋め込み用（`platform.twitter.com`、`platform.twimg.com`）と、編集画面だけ `cdnjs.cloudflare.com`（KaTeX。送り先は `layouts/partials/gh-admin/csp.html` が決める）に限定しています（インラインスクリプトはテーマの初期化に必要なため許可）。Xの埋め込みは `{{< tweet >}}` を利用する記事があるときだけ読み込まれます。
- ユーザーの入力（記事の本文、タイトル、一覧の表示）は `textContent` で描画します。
- `innerHTML` を利用するのはプレビューだけです。プレビューは `script`、`iframe` などの要素と、`on*` 属性、`javascript:` のURLを取り除いてから描画します。
- 記事のslugは `^[a-z0-9-]{1,80}$` で検査します。APIに渡すパスはこの検査を通ったものだけです。

## 取り込み元

管理画面の機能は、別リポジトリ `github.com/kmmz532/hugo-gh-admin` を Hugo Modules で取り込んでいます。バージョンは固定せず、ビルドのたびに最新のタグを利用します（`go.mod` に `require` を書かない）。

## 報告

問題を見つけたら、リポジトリのIssueか、管理者へ直接連絡してください。
