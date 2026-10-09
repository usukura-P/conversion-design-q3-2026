import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as model from '../public/model.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*?;\n/,'').replace(/boot\(\)\.then\([^\n]+\);\s*$/,'');
function harness(){
 const nodes=new Map(),storage=new Map();
 const element=()=>({disabled:false,style:{},dataset:{},classList:{toggle(){},add(){},remove(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},querySelector(sel){return sel==='input:invalid'?null:node(sel);},querySelectorAll(){return [node('#field')];},focus(){},scrollIntoView(){}});
 function node(s){if(!nodes.has(s))nodes.set(s,element());return nodes.get(s);}
 const ctx=vm.createContext({...model,structuredClone,Intl,Date,URL,Blob,AbortController,crypto:globalThis.crypto,console,setTimeout:()=>1,clearTimeout(){},confirm:()=>true,document:{querySelector:node,querySelectorAll:()=>[],body:element()},window:{addEventListener(){}},IntersectionObserver:class{observe(){}},localStorage:{setItem(k,v){storage.set(k,v);},getItem(k){return storage.get(k)||null;},removeItem(k){storage.delete(k);}},seed:model.initialState()});
 vm.runInContext(source+`\nstate=seed;baseState=structuredClone(seed);activeWeek=seed.weeks[0].id;revision='revision-one';config={apiBase:'https://mock.invalid'};apiReady=true;dirty=true;editing=true;editor='QA';globalThis.api={save,render,storeDraft,history,dispatchChart,report,initiativeDetails,articleSection,safeUrl,get:()=>({state,revision,dirty,saving,syncing,pendingSave,conflict,mergeConflicts}),set:(values)=>{for(const [k,v] of Object.entries(values))globalThis.setValue(k,v);}};globalThis.setValue=(k,v)=>eval(k+' = v');`,ctx);
 return {ctx,api:ctx.api,node,storage,set:(key,value)=>ctx.setValue(key,value),request:fn=>{ctx.mockRequest=fn;vm.runInContext('request=mockRequest',ctx);},click(action){const button={dataset:{action},disabled:false};return node('#main').listeners.click({target:{closest:selector=>selector==='[data-action]'?button:null}});}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('failed save keeps exact retry envelope and duplicate clicks issue one request',async()=>{
 const h=harness(),wait=deferred(),sent=[];h.request(async(u,o)=>{sent.push(o?.body);return wait.promise;});
 const first=h.api.save();await h.api.save();assert.equal(sent.length,1);assert.equal(h.api.get().saving,true);assert.equal(h.node('#field').disabled,true);
 wait.reject(new Error('network down'));await first;assert.equal(h.api.get().dirty,true);const envelope=sent[0];assert.equal(h.api.get().saving,false);
 h.request(async(u,o)=>{if(o){sent.push(o.body);return {state:JSON.parse(o.body).state,revision:'saved'};}return {state:model.initialState(),revision:'saved'};});await h.api.save();assert.equal(sent[1],envelope);assert.equal(h.api.get().dirty,false);
});
test('409 preserves draft and blocks direct save until conflict resolution',async()=>{
 const h=harness();let calls=0;h.request(async()=>{calls++;throw Object.assign(new Error('conflict'),{status:409});});await h.api.save();assert.equal(h.api.get().conflict,true);assert.equal(h.api.get().pendingSave,null);assert.equal(h.storage.size,1);await h.api.save();assert.equal(calls,1);
 h.set('conflict',false);h.set('mergeConflicts',[{path:['test']}]);await h.api.save();assert.equal(calls,1);
});
test('latest refresh locks input and navigation until completion and keeps original draft',async()=>{
 const h=harness(),wait=deferred();h.api.get().state.weeks[0].team.status='local draft';h.request(()=>wait.promise);
 const reading=h.click('latest');assert.equal(h.api.get().syncing,true);assert.equal(h.node('#field').disabled,true);
 const input={id:'',dataset:{path:'weeks.0.team.status'},value:'too late'};h.node('#main').listeners.input({target:input});assert.equal(h.api.get().state.weeks[0].team.status,'local draft');
 wait.resolve({state:model.initialState(),revision:'new'});await reading;assert.equal(h.api.get().syncing,false);assert.equal(h.api.get().dirty,false);assert.match([...h.storage.values()][0],/local draft/);
});
test('storage cleanup failure cannot turn a successful save into a failed save',async()=>{
 const h=harness();h.ctx.localStorage.removeItem=()=>{throw new Error('storage denied');};h.request(async(u,o)=>({state:o?JSON.parse(o.body).state:model.initialState(),revision:'saved'}));await h.api.save();assert.equal(h.api.get().dirty,false);assert.equal(h.api.get().revision,'saved');assert.doesNotMatch(h.node('#toast').textContent,/保存できませんでした/);
});
test('render escapes saved and draft HTML and rejects executable link schemes',()=>{
 const h=harness(),payload='<img src=x onerror="alert(1)">';h.api.get().state.weeks[0].team.status=payload;h.api.render();assert.ok(h.node('#main').innerHTML.includes('&lt;img'));assert.ok(!h.node('#main').innerHTML.includes(payload));
 for(const url of ['javascript:alert(1)','data:text/html,x','//bad.invalid','https://user:password@example.com'])assert.equal(h.api.safeUrl(url),false);assert.equal(h.api.safeUrl('https://example.com'),true);
});
test('unrecorded history does not invent zero proposals and dispatch graph scales above target',()=>{
 const h=harness();assert.match(h.api.history(),/立案 —件/);h.api.get().state.weeks[0].metrics.asOf='2026-10-12T00:00:00Z';h.api.get().state.weeks[0].metrics.dispatched=30;const svg=h.api.dispatchChart();assert.doesNotMatch(svg,/cy="-/);
});
test('entering edit mode does not overwrite an unopened stored draft',()=>{
 const h=harness();h.set('editing',false);h.set('dirty',false);h.set('draftAvailable',{state:model.initialState()});h.node('#edit-toggle').listeners.click();assert.match(h.node('#toast').textContent,/下書き/);
});
test('snapshot preparation errors restore editable controls and preserve dirty state',async()=>{
 const h=harness();h.set('activeWeek','missing');let calls=0;h.request(async()=>{calls++;});await h.api.save();assert.equal(calls,0);assert.equal(h.api.get().saving,false);assert.equal(h.api.get().dirty,true);assert.equal(h.node('#field').disabled,false);
});
test('readback failure reports successful save with reconnect warning, not unsaved work',async()=>{
 const h=harness();h.request(async(u,o)=>{if(o)return {state:JSON.parse(o.body).state,revision:'saved'};throw new Error('offline');});await h.api.save();assert.equal(h.api.get().dirty,false);assert.equal(h.api.get().revision,'saved');assert.match(h.node('#main').innerHTML,/保存は成功しましたが/);
});
test('every app model import is exported by the shipped module',()=>{
 const imports=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').match(/^import \{([^}]+)\}/)[1].split(',').map(v=>v.trim());
 for(const name of imports)assert.ok(name in model,`Missing model export: ${name}`);
});
test('a concurrent initiative deletion requires explicit article relinking before save',async()=>{
 const h=harness();h.api.get().state.articles=[{id:'article',title:'Draft',owner:'aoki',releaseDate:'2026-10-05',metaCv:null,metaClicks:null,observedThrough:null,initiativeId:'deleted-initiative'}];let calls=0;h.request(async()=>{calls++;});await h.api.save();assert.equal(calls,0);assert.equal(h.api.get().dirty,true);assert.match(h.node('#toast').textContent,/関連施策を選び直して/);assert.match(h.node('#main').innerHTML,/削除済みの施策/);
});
