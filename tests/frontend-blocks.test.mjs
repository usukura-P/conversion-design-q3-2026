import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,createWeek,makeBlockDraft,mergeBlockDraft,overlayBlockDrafts,blockValue,chooseBlockConflict,exportBlockDrafts,prepareSave} from '../public/model.js';
const path=k=>['weeks',{key:'id',id:'2026-10-12'},'team',k];
const edit=(s,k,v)=>{const d=makeBlockDraft(s,path(k));d.mine=v;return d;};
test('one block save excludes another local input and preserves unrelated shared updates',()=>{
 const base=initialState(),a=edit(base,'status','mine A'),b=edit(base,'requests','mine B'),fresh=structuredClone(base);fresh.weeks[0].team.issues='someone else';
 const merged=mergeBlockDraft(a,fresh);assert.equal(merged.state.weeks[0].team.status,'mine A');assert.equal(merged.state.weeks[0].team.requests,'');assert.equal(merged.state.weeks[0].team.issues,'someone else');
 const displayed=overlayBlockDrafts(merged.state,{b});assert.equal(displayed.weeks[0].team.requests,'mine B');assert.equal(displayed.weeks[0].team.issues,'someone else');
});
test('same field conflict retains both alternatives across successive rebase and JSON export',()=>{
 const base=initialState(),draft=edit(base,'status','mine'),fresh=structuredClone(base);fresh.weeks[0].team.status='theirs';
 let result=mergeBlockDraft(draft,fresh);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].mine,'mine');
 const rebased={...draft,baseState:fresh,mine:blockValue(result.state,draft.path),conflicts:result.conflicts};const newer=structuredClone(fresh);newer.weeks[0].team.requests='unrelated';result=mergeBlockDraft(JSON.parse(JSON.stringify(rebased)),newer);
 assert.equal(result.conflicts.length,1);const out=exportBlockDrafts(newer,{status:{...rebased,conflicts:result.conflicts}});assert.equal(out.mine.weeks[0].team.status,'mine');assert.equal(out.drafts.status.conflicts[0].theirs,'theirs');
 chooseBlockConflict(rebased,0,'mine');assert.equal(rebased.mine,'mine');assert.equal(rebased.conflicts.length,0);
});
test('whole article records merge different fields while preserving other article records',()=>{
 const base=initialState();base.articles=[{id:'one',title:'old',owner:'aoki'},{id:'two',title:'unchanged',owner:'kantake'}];const d=makeBlockDraft(base,['articles',{key:'id',id:'one'}]);d.mine.title='my title';const fresh=structuredClone(base);fresh.articles[0].owner='nakagawa';fresh.articles[1].title='new by colleague';
 const out=mergeBlockDraft(d,fresh);assert.equal(out.conflicts.length,0);assert.deepEqual(out.state.articles,[{id:'one',title:'my title',owner:'nakagawa'},{id:'two',title:'new by colleague',owner:'kantake'}]);
});
test('a deleted parent blocks leaf save rather than reconstructing partial or stale shared week',()=>{
 const base=initialState(),d=edit(base,'status','mine'),fresh=structuredClone(base);fresh.weeks=[createWeek('2026-10-19')];const out=mergeBlockDraft(d,fresh);assert.equal(out.parentMissing,true);assert.equal(out.state.weeks.length,1);assert.equal(out.state.weeks[0].id,'2026-10-19');
});
test('old metrics and immutable baseline cannot come from a block draft',()=>{
 const base=initialState();base.weeks.push(createWeek('2026-10-19'));base.weeks[0].metrics.asOf='2026-10-12T00:00:00Z';base.weeks[0].metrics.teamCvr=2;const d=edit(base,'status','past wording');d.baseState.weeks[0].metrics.teamCvr=9;const fresh=structuredClone(base);fresh.baseline.septemberCvr=1.65;
 const out=prepareSave(mergeBlockDraft(d,fresh).state,'2026-10-12');assert.equal(out.weeks[0].metrics.teamCvr,2);assert.equal(out.baseline.septemberCvr,1.65);
});
test('new and deleted record scopes do not replace unrelated arrays',()=>{
 const base=initialState();base.initiatives=[{id:'old',title:'old'}];const add=makeBlockDraft(base,['initiatives',{key:'id',id:'new'}]);add.mine={id:'new',title:'new'};const fresh=structuredClone(base);fresh.initiatives.push({id:'other',title:'someone else'});let out=mergeBlockDraft(add,fresh);assert.equal(out.state.initiatives.length,3);
 const del=makeBlockDraft(fresh,['initiatives',{key:'id',id:'old'}]);del.mine=undefined;out=mergeBlockDraft(del,fresh);assert.deepEqual(out.state.initiatives.map(x=>x.id),['other']);
});
