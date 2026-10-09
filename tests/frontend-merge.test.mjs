import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,createWeek,mergeStates,applyConflictChoice,rebaseDraft} from '../public/model.js';

const clone=value=>structuredClone(value);
const article=(overrides={})=>({id:'a',title:'Original article',owner:'aoki',releaseDate:'2026-10-05',metaCv:3,metaClicks:100,observedThrough:null,initiativeId:null,...overrides});
const makeConflict=()=>{
 const base=initialState(),mine=clone(base),theirs=clone(base);
 mine.weeks[0].team.status='My conclusion';
 theirs.weeks[0].team.status='Shared conclusion';
 return {base,mine,theirs,merged:mergeStates(base,mine,theirs)};
};

test('rebasing preserves unresolved mine when a newer revision only changes another field',()=>{
 const {theirs,merged}=makeConflict();
 const latest=clone(theirs);latest.weeks[0].team.requests='New shared request';
 const before=clone({theirs,merged,latest});
 const result=rebaseDraft(theirs,merged.state,latest,merged.conflicts);
 assert.equal(result.conflicts.length,1);
 assert.equal(result.conflicts[0].mine,'My conclusion');
 assert.equal(result.conflicts[0].theirs,'Shared conclusion');
 assert.equal(result.state.weeks[0].team.status,'Shared conclusion');
 assert.equal(result.state.weeks[0].team.requests,'New shared request');
 applyConflictChoice(result.state,result.conflicts[0],'mine');
 assert.equal(result.state.weeks[0].team.status,'My conclusion');
 assert.deepEqual({theirs,merged,latest},before);
});

test('successive JSON-persisted rebases retain original mine and refresh the shared alternative',()=>{
 const {theirs,merged}=makeConflict();
 let base=theirs,draft=JSON.parse(JSON.stringify(merged));
 for(const conclusion of ['Second shared conclusion','Third shared conclusion']){
  const latest=clone(base);latest.weeks[0].team.status=conclusion;
  draft=JSON.parse(JSON.stringify(rebaseDraft(base,draft.state,latest,draft.conflicts)));
  assert.equal(draft.conflicts.length,1);
  assert.equal(draft.conflicts[0].mine,'My conclusion');
  assert.equal(draft.conflicts[0].theirs,conclusion);
  assert.equal(draft.state.weeks[0].team.status,conclusion);
  base=latest;
 }
});

test('an unresolved choice disappears only when both values converge',()=>{
 const {theirs,merged}=makeConflict();const latest=clone(theirs);
 latest.weeks[0].team.status='My conclusion';
 const result=rebaseDraft(theirs,merged.state,latest,merged.conflicts);
 assert.deepEqual(result.conflicts,[]);
 assert.equal(result.state.weeks[0].team.status,'My conclusion');
});

test('rebasing keeps resolved/local edits while retaining multiple pending choices',()=>{
 const base=initialState(),mine=clone(base),theirs=clone(base);
 mine.weeks[0].team.status='My status';mine.weeks[0].team.issues='My issues';
 theirs.weeks[0].team.status='Shared status';theirs.weeks[0].team.issues='Shared issues';
 const first=mergeStates(base,mine,theirs);
 first.state.weeks[0].members.aoki.reflection='Local reflection';
 const latest=clone(theirs);latest.weeks[0].members.kantake.reflection='Shared reflection';
 const result=rebaseDraft(theirs,first.state,latest,first.conflicts);
 assert.equal(result.conflicts.length,2);
 assert.equal(result.state.weeks[0].members.aoki.reflection,'Local reflection');
 assert.equal(result.state.weeks[0].members.kantake.reflection,'Shared reflection');
 for(const conflict of result.conflicts)applyConflictChoice(result.state,conflict,'mine');
 assert.equal(result.state.weeks[0].team.status,'My status');
 assert.equal(result.state.weeks[0].team.issues,'My issues');
});

test('a pending field choice is promoted to a whole-record choice after a shared delete',()=>{
 const base=initialState();base.articles=[article()];
 const mine=clone(base),theirs=clone(base);
 mine.articles[0].title='My title';mine.articles[0].metaCv=7;
 theirs.articles[0].title='Shared title';
 const first=mergeStates(base,mine,theirs),latest=clone(theirs);latest.articles=[];
 const result=rebaseDraft(theirs,first.state,latest,first.conflicts);
 assert.deepEqual(result.state.articles,[]);
 assert.equal(result.conflicts.length,1);
 assert.deepEqual(result.conflicts[0].path,['articles',{key:'id',id:'a'}]);
 assert.equal(result.conflicts[0].theirsDelete,true);
 assert.equal(result.conflicts[0].mine.title,'My title');
 assert.equal(result.conflicts[0].mine.metaCv,7);
 applyConflictChoice(result.state,result.conflicts[0],'mine');
 assert.equal(result.state.articles[0].title,'My title');
 assert.equal(result.state.articles[0].metaCv,7);
});

test('a pending local delete survives persistence and unrelated shared changes',()=>{
 const base=initialState();base.articles=[article()];
 const mine=clone(base),theirs=clone(base);mine.articles=[];theirs.articles[0].title='Shared title';
 const first=JSON.parse(JSON.stringify(mergeStates(base,mine,theirs)));
 const latest=clone(theirs);latest.monthlyRevenue[0].actual=123;
 const result=rebaseDraft(theirs,first.state,latest,first.conflicts);
 assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].mineDelete,true);
 assert.equal(result.state.articles[0].title,'Shared title');
 applyConflictChoice(result.state,result.conflicts[0],'mine');
 assert.deepEqual(result.state.articles,[]);
});

test('a pending shared delete remains explicit and does not silently restore the local record',()=>{
 const base=initialState();base.articles=[article()];
 const mine=clone(base),theirs=clone(base);mine.articles[0].title='My title';theirs.articles=[];
 const first=JSON.parse(JSON.stringify(mergeStates(base,mine,theirs)));
 const latest=clone(theirs);latest.monthlyRevenue[0].actual=123;
 const result=rebaseDraft(theirs,first.state,latest,first.conflicts);
 assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].theirsDelete,true);
 assert.deepEqual(result.state.articles,[]);
 applyConflictChoice(result.state,result.conflicts[0],'mine');
 assert.equal(result.state.articles[0].title,'My title');
});

test('an old whole-record choice supersedes new nested conflicts when the record is restored',()=>{
 const base=initialState();base.articles=[article()];
 const mine=clone(base),theirs=clone(base);mine.articles[0].title='My title';theirs.articles=[];
 const first=mergeStates(base,mine,theirs),latest=clone(theirs);
 latest.articles=[article({title:'Restored title',metaCv:8})];
 const result=rebaseDraft(theirs,first.state,latest,first.conflicts);
 assert.equal(result.conflicts.length,1);
 assert.deepEqual(result.conflicts[0].path,['articles',{key:'id',id:'a'}]);
 assert.deepEqual(result.state.articles,latest.articles);
 applyConflictChoice(result.state,result.conflicts[0],'mine');
 assert.deepEqual(result.state.articles,mine.articles);
});

test('resolved choices stay resolved and a new overlapping edit creates a fresh conflict',()=>{
 const {theirs,merged}=makeConflict();
 applyConflictChoice(merged.state,merged.conflicts[0],'mine');
 const latest=clone(theirs);latest.weeks[0].team.status='New shared conclusion';
 const result=rebaseDraft(theirs,merged.state,latest,[]);
 assert.equal(result.conflicts.length,1);
 assert.equal(result.conflicts[0].mine,'My conclusion');
 assert.equal(result.conflicts[0].theirs,'New shared conclusion');
});

test('ordinary rebase delegates to the normal merge for keyed month rows and concurrent additions',()=>{
 const base=initialState(),mine=clone(base),theirs=clone(base);
 mine.monthlyRevenue[0].actual=100;theirs.monthlyRevenue[1].actual=200;
 mine.articles=[article({id:'mine'})];theirs.articles=[article({id:'theirs'})];
 assert.deepEqual(rebaseDraft(base,mine,theirs),mergeStates(base,mine,theirs));
 const result=rebaseDraft(base,mine,theirs);
 assert.equal(result.state.monthlyRevenue[0].actual,100);
 assert.equal(result.state.monthlyRevenue[1].actual,200);
 assert.deepEqual(result.state.articles.map(x=>x.id),['theirs','mine']);
});

test('shared baseline, timestamps and historical snapshots override stale draft data',()=>{
 const {theirs,merged}=makeConflict();
 merged.state.baseline.septemberRevenue=1;merged.state.updatedAt='2026-10-01T00:00:00Z';
 merged.state.weeks[0].metrics.teamCvr=99;
 const latest=clone(theirs);latest.updatedAt='2026-11-02T00:00:00Z';
 latest.baseline.septemberRevenue=555;latest.weeks[0].metrics.teamCvr=2;
 latest.weeks[0].metrics.monthlyRevenue=clone(latest.monthlyRevenue);
 latest.weeks.unshift(createWeek('2026-11-02'));
 const result=rebaseDraft(theirs,merged.state,latest,merged.conflicts);
 applyConflictChoice(result.state,result.conflicts[0],'mine');
 assert.deepEqual(result.state.baseline,latest.baseline);
 assert.equal(result.state.updatedAt,latest.updatedAt);
 assert.deepEqual(result.state.weeks.find(w=>w.id==='2026-10-12').metrics,latest.weeks[1].metrics);
});

test('restoring a deleted historical week never restores stale draft metrics',()=>{
 const base=initialState();base.weeks.unshift(createWeek('2026-11-02'));
 base.weeks[1].metrics.teamCvr=2;base.weeks[1].metrics.monthlyRevenue=clone(base.monthlyRevenue);
 const mine=clone(base),theirs=clone(base);
 mine.weeks[1].team.status='Corrected historical wording';mine.weeks[1].metrics.teamCvr=99;
 mine.weeks[1].metrics.monthlyRevenue[0].actual=999;
 theirs.weeks.pop();
 const result=mergeStates(base,mine,theirs);
 assert.equal(result.conflicts.length,1);
 applyConflictChoice(result.state,result.conflicts[0],'mine');
 assert.deepEqual(result.state.weeks.find(w=>w.id==='2026-10-12').metrics,base.weeks[1].metrics);
});

test('snapshot-only drift does not turn a shared week deletion into an editable conflict',()=>{
 const base=initialState();base.weeks.unshift(createWeek('2026-11-02'));
 const mine=clone(base),theirs=clone(base);
 mine.weeks[1].metrics.teamCvr=99;theirs.weeks.pop();
 const result=mergeStates(base,mine,theirs);
 assert.deepEqual(result.conflicts,[]);
 assert.deepEqual(result.state.weeks,theirs.weeks);
});

test('choosing a deleted or stale nested path is a safe no-op instead of creating a partial record',()=>{
 const {merged}=makeConflict();merged.state.weeks=[];
 assert.equal(applyConflictChoice(merged.state,merged.conflicts[0],'mine'),false);
 assert.deepEqual(merged.state.weeks,[]);
});

test('rebasing an explicitly deleted parent does not resurrect its pending child field',()=>{
 const base=initialState();base.articles=[article()];
 const mine=clone(base),theirs=clone(base);mine.articles[0].title='My title';theirs.articles[0].title='Shared title';
 const first=mergeStates(base,mine,theirs);first.state.articles=[];
 const latest=clone(theirs);latest.monthlyRevenue[0].actual=123;
 const result=rebaseDraft(theirs,first.state,latest,first.conflicts);
 assert.deepEqual(result.state.articles,[]);assert.deepEqual(result.conflicts,[]);
});
