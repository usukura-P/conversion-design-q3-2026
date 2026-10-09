import test from 'node:test';
import assert from 'node:assert/strict';
import { previousWeek, mondayFor, articleEvaluation, summarizeArticles, calculateMetrics, prepareSave, createWeek, initialState } from '../public/model.js';
const article = (overrides={}) => ({id:'a',title:'新規テスト',owner:'aoki',releaseDate:'2026-10-05',metaCv:3,metaClicks:100,observedThrough:'2026-10-11',initiativeId:null,...overrides});

test('月曜の対象は前週の月曜〜日曜。年・月をまたいでもJSTで固定', () => {
 assert.deepEqual(previousWeek('2026-10-12'),{start:'2026-10-05',end:'2026-10-11'});
 assert.deepEqual(previousWeek('2027-01-04'),{start:'2026-12-28',end:'2027-01-03'});
 assert.equal(mondayFor('2026-10-11'),'2026-10-05');
});
test('貸し・修正は除外。改修・小額配信は対象。0 CVは測定可能',()=>{
 for(const title of ['貸し出し記事','★修正_記事']) assert.equal(articleEvaluation(article({title})).status,'excluded');
 assert.equal(articleEvaluation(article({title:'改修記事',metaCv:0})).cvr,0);
 assert.equal(articleEvaluation(article({title:'改修記事'})).cvr,3);
});
test('nullとクリック0は未測定として区別し、平均に入れない',()=>{
 assert.equal(articleEvaluation(article({metaClicks:0})).status,'unmeasurable');
 assert.equal(articleEvaluation(article({metaCv:null})).status,'unmeasurable');
 const result=summarizeArticles([article(),article({id:'b',metaClicks:1000,metaCv:60}),article({id:'c',metaClicks:0}),article({id:'d',title:'修正'})]);
 assert.equal(result.cvr,4.5); // 記事単純平均 (3 + 6) / 2。合算CVRではない。
 assert.equal(result.eligible,2);assert.equal(result.unmeasurable,1);assert.equal(result.excluded,1);
 assert.equal(summarizeArticles([]).cvr,null);
});
test('3Qの日付境界と前週コホート・個人立案／配信の集計',()=>{
 const state=initialState();
 state.articles=[article(),article({id:'sept',releaseDate:'2026-09-30',metaCv:99}),article({id:'next',releaseDate:'2026-10-12',metaCv:5}),article({id:'last',releaseDate:'2026-12-31',metaCv:50}),article({id:'outside',releaseDate:'2027-01-01',metaCv:90})];
 state.initiatives=[{owner:'aoki',meetingDate:'2026-10-01',dispatchDate:'2026-10-10'},{owner:'aoki',meetingDate:'2026-09-30',dispatchDate:null},{owner:'nakagawa',meetingDate:'2026-12-31',dispatchDate:'2027-01-01'}];
 const m=calculateMetrics(state,createWeek('2026-10-12'),'2026-10-12T09:00:00+09:00');
 assert.equal(m.teamCvr,4);assert.equal(m.previousWeekCvr,3);assert.equal(m.people.aoki.proposals,1);assert.equal(m.people.nakagawa.proposals,0);assert.equal(m.dispatched,1);assert.equal(m.people.usukura.cvr,m.teamCvr);
});
test('保存する週だけスナップショット更新。他週とbaselineは不変、元stateにも副作用なし',()=>{
 const state=initialState();state.weeks.unshift(createWeek('2026-10-19'));state.weeks[1].metrics.teamCvr=1.23;state.articles=[article()];
 const old=structuredClone(state);const result=prepareSave(state,'2026-10-19','2026-10-19T00:00:00Z');
 assert.equal(result.weeks[0].metrics.teamCvr,3);assert.equal(result.weeks[1].metrics.teamCvr,1.23);assert.deepEqual(state,old);assert.deepEqual(result.baseline,old.baseline);
});

test('11/2に10/12の文言を編集しても過去metricsは書き換わらない',()=>{
 const state=initialState();state.weeks.unshift(createWeek('2026-11-02'));state.weeks[1].metrics={...state.weeks[1].metrics,asOf:'2026-10-12T00:00:00Z',teamCvr:1.5,previousWeekCvr:1.2};state.articles=[article({metaCv:9})];
 state.weeks[1].team.status='文章の訂正';const before=structuredClone(state.weeks[1].metrics);
 assert.deepEqual(prepareSave(state,'2026-10-12','2026-11-02T00:00:00Z').weeks[1].metrics,before);
});

import {mergeStates,applyConflictChoice} from '../public/model.js';
test('同時編集は別欄なら統合。同じ欄は最新を維持し明示選択を要求',()=>{
 const base=initialState(),mine=structuredClone(base),theirs=structuredClone(base);
 mine.weeks[0].team.status='自分の結論';mine.weeks[0].members.aoki.reflection='青木の振り返り';
 theirs.weeks[0].team.status='他の人の結論';theirs.weeks[0].members.kantake.reflection='寒竹の振り返り';
 const merged=mergeStates(base,mine,theirs);assert.equal(merged.state.weeks[0].members.aoki.reflection,'青木の振り返り');assert.equal(merged.state.weeks[0].members.kantake.reflection,'寒竹の振り返り');assert.equal(merged.state.weeks[0].team.status,'他の人の結論');assert.equal(merged.conflicts.length,1);
 applyConflictChoice(merged.state,merged.conflicts[0],'mine');assert.equal(merged.state.weeks[0].team.status,'自分の結論');
});
test('同時追加・削除で配列を丸ごと上書きせず、更新済み項目の削除は競合',()=>{
 const base=initialState();base.articles=[article()];const mine=structuredClone(base),theirs=structuredClone(base);mine.articles=[];mine.initiatives=[{id:'mine',title:'自分'}];theirs.articles[0].metaCv=5;theirs.initiatives=[{id:'theirs',title:'他の人'}];
 const result=mergeStates(base,mine,theirs);assert.equal(result.state.initiatives.length,2);assert.equal(result.state.articles[0].metaCv,5);assert.equal(result.conflicts.length,1);applyConflictChoice(result.state,result.conflicts[0],'mine');assert.equal(result.state.articles.length,0);
});

test('売上も週ごとのスナップショットを保持し、過去編集で現在値に変えない',()=>{
 const state=initialState();state.monthlyRevenue[0].actual=100;
 const saved=prepareSave(state,'2026-10-12','2026-10-12T00:00:00Z');assert.equal(saved.weeks[0].metrics.monthlyRevenue[0].actual,100);
 saved.weeks.unshift(createWeek('2026-11-02'));saved.monthlyRevenue[0].actual=999;
 assert.equal(prepareSave(saved,'2026-10-12','2026-11-02T00:00:00Z').weeks[1].metrics.monthlyRevenue[0].actual,100);
});

import {readFileSync} from 'node:fs';
test('published baseline arithmetic agrees with source article counts and individual averages',()=>{
 const state=JSON.parse(readFileSync(new URL('../data/state.json',import.meta.url),'utf8'));
 for(const [prefix,key] of [['2026-09','septemberCvr'],['2026-','q2Cvr']]){
  const articles=state.baseline.articles.filter(a=>a.releaseDate.startsWith(prefix));
  const actual=summarizeArticles(articles).cvr;assert.ok(Math.abs(actual-state.baseline[key])<1e-12);
  for(const person of state.baseline.people){const average=summarizeArticles(articles.filter(a=>a.owner===person.id)).cvr;if(average===null)assert.equal(person[key],null);else assert.ok(Math.abs(average-person[key])<1e-12);}
 }
});
test('JST midnight cutoff includes October 1 and excludes future releases',()=>{
 const state=initialState();state.articles=[article({releaseDate:'2026-10-01'})];
 assert.equal(calculateMetrics(state,state.weeks[0],'2026-09-30T14:59:59Z').teamCvr,null);
 assert.equal(calculateMetrics(state,state.weeks[0],'2026-09-30T15:00:00Z').teamCvr,3);
});
