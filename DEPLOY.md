# 匿名編集APIの公開手順

フロントはGitHub Pages、保存APIはCloud Run。閲覧・編集にログインや合言葉を要求しない合意に従う。

## 固定した保存先

- repo: `usukura-P/conversion-design-q3-2026`
- branch: `codex/3q-dashboard`
- file: `data/state.json`
- `GITHUB_DEPLOY_KEY_B64`: 上記repo限定のwrite deploy keyをbase64にした秘密値。ブラウザ・公開config・ログへ出さない。
- GitHub REST token方式はローカル開発・mock用。`GITHUB_TOKEN`よりrepo限定deploy keyを本番で使う。

APIは全schemaを検証し、baselineを変更不可にする。Git blob SHAのrevisionで競合を検出し409を返す。requestIdと入力内容のhashをcommitに記録し、プロセス再起動や別の更新後も同一リクエストを二重保存しない。別の人の更新後に古いリクエストが再送されても、現在の状態を返し、過去内容で上書きしない。Git履歴がこの記録を兼ねるためforce pushしない。

サーバーは起動後の初回利用時に`/tmp/q3-progress-*`へ専用checkoutとmode600の鍵を作る。GitHub公式`https://api.github.com/meta`から2026-10-09にHTTPSで確認した公開host keysを`server/github_known_hosts`へ同梱し、SSHの接続先公開鍵検証を有効にする。実行時にGitHub REST APIは呼ばない。公式[SSH over HTTPS port](https://docs.github.com/en/authentication/troubleshooting-ssh/using-ssh-over-the-https-port)の`ssh.github.com:443`を使用する。鍵が変更された場合は公式HTTPS metaと指紋を照合して同梱ファイルを更新する。キーとtokenはgit子プロセスの環境へ引き継がない（鍵のファイルパスのみ）。GitHubへのpush後にfetch/readbackして保存を確認する。

## ローカル検証

```bash
node --test server/*.test.mjs tests/*.test.mjs
PORT=8080 node server/index.mjs
```

`GET /health`、`GET /api/state`、`POST /api/state`。POSTはJSONの`{state, revision, requestId, editor}`、上限512KB。CORSは`https://usukura-p.github.io`およびhttp localhost/127.0.0.1だけを許可する。OriginなしのCLIアクセスも可能。これは認証として扱わない。

## 保存APIとフロント公開

保存APIはCloud Runで公開済み。今回のフロント公開では再デプロイや設定変更を行わない。

- API: https://q3-progress-api-295429960025.asia-northeast1.run.app
- フロント: https://usukura-p.github.io/conversion-design-q3-2026/
- API契約: `SCHEMA.md`。フロント接続先: `public/config.json`。

repo限定deploy keyはサーバー側のみで管理する。将来の再デプロイ時も既存の秘密設定を維持し、秘密値を読み出して表示したり公開ファイルへ含めたりしない。鍵の漏えい時はGitHub repo settingsで失効させる。

公開originを維持する。別originに移行する場合はCORS設定の別途見直しが必要。Cloud Run初回保存はcheckout準備を伴う。

## 障害時・復元

409や502時は端末の下書きを維持する。最新を読み込み、内容を照合して新しい保存を実行する。応答が途切れた保存の再試行は同じrequestId・同じ内容を使う。任意の過去データへ戻す際はGit履歴のstate.jsonを確認し、それを新しいcommitとして復元する。公開URLは保ち、Git履歴と重複防止台帳を消さない。

## フロント公開前の回帰検証

Pages workflow は Node.js 24 で `node --test server/*.test.mjs tests/*.test.mjs` が通ってから公開する。テストはローカルfixture／mockだけを使い、本番APIへ書き込まない。

フロントの保存失敗・409・同一リクエスト再送・下書き再開・最新読込中の入力保護・XSSエスケープ・過去スナップショット・既存基準値の算術を検証対象に含める。公開時には対象commitのActions成功と公開URLを別途確認する。

2026-10-09 JSTのクラウドQAでは61件成功・失敗0件。共有のstate.jsonは既存commitと同一で、3Q実績は未入力のまま。以前の公開準備で本番GET・POST・再送dedup・旧revision409を検証済みだが、今回のQAでは本番データを更新していない。公開後のPC・スマホ読取専用ブラウザQAは未実施。
