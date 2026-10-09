# 共有データとAPI契約

- 静的frontend: public/index.html, public/style.css, public/app.js, public/model.js。ES modules、依存最小。
- 公開データ: data/state.json。baseline agent担当はdata/baseline.jsonのみ。初期state生成・baselineマージはfrontend担当。
- app設定: public/config.json {"apiBase":"URL", "repo":"usukura-P/conversion-design-q3-2026", "branch":"codex/3q-dashboard"}。秘密なし。

## state (schemaVersion 1)
- schemaVersion:1, updatedAt:ISO UTC|null
- baseline: {septemberRevenue:554427123,septemberCvr:number|null,q2Cvr:number|null,people:[{id:"usukura"|"kantake"|"aoki"|"nakagawa",name:string,septemberCvr:number|null,q2Cvr:number|null}],articles:array,sources:array,notes:array}。CVRの単位は%（3.0）。baselineは読取専用としてサーバーで変更拒否。
- monthlyRevenue: [{month:"2026-10"|"2026-11"|"2026-12",actual:number|null,asOf:"YYYY-MM-DD"|null}]
- articles: [{id:string,title:string,owner:上記id,releaseDate:"YYYY-MM-DD",metaCv:number|null,metaClicks:number|null,observedThrough:"YYYY-MM-DD"|null,initiativeId:string|null}]
- initiatives: [{id:string,title:string,owner:id,stage:"idea"|"meeting"|"agreed"|"production"|"released"|"dispatched"|"reviewed",meetingDate:date|null,dispatchDate:date|null,deadline:date|null,evidence:string,background:string,craft:string,feedback:string,learning:string,next:string,url:string}]
- weeks: [{id:月曜の日付,releaseStart:前週月曜,releaseEnd:前週日曜,team:{status:string,change:string,issues:string,priorities:string,requests:string},members:{各id:{reflection:string,feedback:string,action:string}},qualitative:[{id:string,status:"not_started"|"in_progress"|"achieved",evidence:string,next:string}],metrics:{asOf:ISO|null,teamCvr:number|null,previousWeekCvr:number|null,eligibleArticles:number,unmeasurableArticles:number,dispatched:number,monthlyRevenue:月次実績3件のスナップショット（旧記録では省略可）,people:{各id:{cvr:number|null,proposals:number}}}}]
- goalsはコード内固定: 売上・CVR・配信・個人立案と原文定性。state内で変更しない。
- 未入力はnull／空文字、実績0を生成しない。draftはlocalStorage。metricsは最新週を保存するときに現在のstateから生成する。過去週の文言編集では既存metricsを保持し、過去週の未記録metricsも現在データで埋めない。

## baseline.articles
[{id,title,owner,releaseDate,metaCv,metaClicks,cvr:number|null,excluded:boolean}]。過去の原データの公開可否を精査し、秘密を入れない。sources [{label,url,asOf}]。保存サーバーはbaselineをimmutable扱い。

## API
- GET /api/state => {state,revision:string}。GitHub blob SHAをrevisionとして使用。キャッシュなし。
- POST /api/state JSON {state,revision:string,requestId:UUID,editor:string} => {state,revision,commitUrl,updatedAt}。
- revision競合409、検証400、保存不可502等。state path/repo/branchはサーバー固定。編集者名は認証ではなく操作記録。
- GET /health => {ok:true}。
- CORSは公開ページとlocalhost開発origin。誰でも匿名編集を許可（ログイン・合言葉なし）。資格情報はブラウザ非露出。
- 初期公開でAPI未接続のまま完了扱いにしない。

## 週次の数値保全
- 最新週の保存でmetrics.monthlyRevenueにstate.monthlyRevenueを複製する。過去週ではその週のスナップショットを表示し、売上未記録の旧週は未記録と表示する。
- weeksは最低1件。qualitativeはissues/evidence/feedback/knowledge/onboardingの5項目を全て必須とする。
- 保存中は対象欄を停止し、他の欄の入力は下書きとして保持する。最新読込中は全入力を停止する。通信失敗の再送では同じenvelopeを使い、同時編集は重複しない変更のみ統合する。

## 欄ごとの下書き（フロント専用）

API schemaVersion 1は維持する。最新GETに対象欄だけを三方向統合し、既存POST envelopeで送る。チーム・個人は文言ごと、定性は目標ID、売上は月、記事・施策は記録IDが保存単位。未共有の新しい週のみ週全体を保存する。

localStorageの下書きはschemaVersion 2、ページごとのUUIDキーと安定した記録IDパスを使う。競合の両案と失敗時のpendingSaveを保持し、別タブのstorageイベントは現在の入力を置き換えない。ダウンロードには共有状態・自分の案・競合情報を含む。baselineと過去週metricsは共有側を維持する。
