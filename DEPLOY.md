# 匿名編集APIの公開手順

フロントはGitHub Pages、保存APIはCloud Run。閲覧・編集にログインや合言葉を要求しない合意に従う。

## 固定した保存先

- repo: `usukura-P/conversion-design-q3-2026`
- branch: `codex/3q-dashboard`
- file: `data/state.json`
- `GITHUB_DEPLOY_KEY_B64`: 上記repo限定のwrite deploy keyをbase64にした秘密値。ブラウザ・公開config・ログへ出さない。
- GitHub REST token方式はローカル開発・mock用。`GITHUB_TOKEN`よりrepo限定deploy keyを本番で使う。

APIは全schemaを検証し、baselineを変更不可にする。Git blob SHAのrevisionで競合を検出し409を返す。requestIdと入力内容のhashをcommitに記録し、プロセス再起動や別の更新後も同一リクエストを二重保存しない。別の人の更新後に古いリクエストが再送されても、現在の状態を返し、過去内容で上書きしない。Git履歴がこの記録を兼ねるためforce pushしない。

サーバーは起動後の初回利用時に`/tmp/q3-progress-*`へ専用checkoutとmode600の鍵を作る。GitHub `/meta`をHTTPSで読み、SSHの接続先公開鍵検証を有効にする。キーとtokenはgit子プロセスの環境へ引き継がない（鍵のファイルパスのみ）。GitHubへのpush後にfetch/readbackして保存を確認する。

## ローカル検証

```bash
node --test server/*.test.mjs
PORT=8080 node server/index.mjs
```

`GET /health`、`GET /api/state`、`POST /api/state`。POSTはJSONの`{state, revision, requestId, editor}`、上限512KB。CORSは`https://usukura-p.github.io`およびhttp localhost/127.0.0.1だけを許可する。OriginなしのCLIアクセスも可能。これは認証として扱わない。

## Cloud Run

既存LP tracking環境の候補: project `axis-lp-tracking-20260806`、region `asia-northeast1`。既存LP tracking serviceを変更せず、新規`q3-progress-api`を使用する。

2026-10-09の読取調査で、ユーザーaccount `usukura@shibuya-ad.com`は再認証が必要だった。代替の`persona-agent-sheets@persona-agent-481605.iam.gserviceaccount.com`はproject `persona-agent-481605`でrun.services.create/update/setIamPolicy、iam.serviceAccounts.actAs、cloudbuild.builds.create、storage.buckets.create権限を確認した。ただし親タスクでbilling disabledを確認したためそのprojectでは公開できない。Secret Managerは代替projectで無効で有効化権限なし。ADCも未設定。認証・請求が利用可能なprojectを確認してから下記を実行する。

```bash
gcloud run deploy q3-progress-api \
  --project=axis-lp-tracking-20260806 \
  --region=asia-northeast1 \
  --source=. \
  --allow-unauthenticated \
  --port=8080 \
  --min-instances=0 --max-instances=1 \
  --memory=512Mi --cpu=1 --concurrency=20 \
  --timeout=120 \
  --env-vars-file=/dev/stdin
```

上記のstdinは安全な子プロセスから秘密値を含むYAMLを渡す。コマンドラインに値を書かず、echoやツール出力でも表示しない。Secret Managerが利用可能なら専用secretに保管し`--set-secrets`で注入する。Git限定のdeploy keyは定期更新し、漏えい時はGitHub repo settingsから失効させる。

完成したCloud Run URLを`public/config.json`のapiBaseに設定してGitHub Pagesへ公開する。APIの匿名IAM・CORSと公開ページからの保存→再読込を本番で確認する。Cloud Run初回保存はcheckout準備を伴う。

## 障害時・復元

409や502時は端末の下書きを維持する。最新を読み込み、内容を照合して新しい保存を実行する。応答が途切れた保存の再試行は同じrequestId・同じ内容を使う。任意の過去データへ戻す際はGit履歴のstate.jsonを確認し、それを新しいcommitとして復元する。公開URLは保ち、Git履歴と重複防止台帳を消さない。
