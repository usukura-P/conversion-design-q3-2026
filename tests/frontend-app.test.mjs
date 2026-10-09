import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as model from '../public/model.js';
import {validateState} from '../server/validation.mjs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*?;\n/,'').replace(/boot\(\)\.then\([^\n]+\);\s*$/,'');
function harness(storage=new Map(),seed=model.initialState()){
 const nodes=new Map(),fields=[],windows={};
 const element=()=>({disabled:false,style:{},dataset:{},classList:{toggle(){},add(){},remove(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},querySelector(sel){return sel==='input:invalid'?null:node(sel);},querySelectorAll(sel){return sel==='[data-block]'?fields:[];},focus(){},scrollIntoView(){},matches(){return false;}});
 function node(s){if(!nodes.has(s))nodes.set(s,element());return nodes.get(s);}
 const localStorage={setItem(k,v){storage.set(k,v);},getItem(k){return storage.get(k)||null;},removeItem(k){storage.delete(k);},get length(){return storage.size;},key(i){return [...storage.keys()][i]}};
 const ctx=vm.createContext({...model,structuredClone,Intl,Date,URL,Blob,AbortController,crypto:globalThis.crypto,console,setTimeout:()=>1,clearTimeout(){},confirm:()=>true,document:{querySelector:node,querySelectorAll:()=>[],body:element()},window:{addEventListener(t,f){windows[t]=f;}},IntersectionObserver:class{observe(){}},localStorage,seed});
 vm.runInContext(source+`\nstate=structuredClone(seed);sharedState=structuredClone(seed);activeWeek=seed.weeks[0].id;revision='r1';config={apiBase:'https://mock.invalid'};apiReady=true;editor='QA';globalThis.api={saveBlock,render,storeDraft,history,dispatchChart,report,initiativeDetails,articleSection,safeUrl,refreshShared,scanDrafts,downloadDraft,get:()=>({state,sharedState,revision,dirty,savingKey,syncing,blockDrafts,availableDrafts}),path:inputBlockPath,valuePath:stableInputPath,keyFor,getKey:()=>OWN_DRAFT_KEY,export:()=>exportBlockDrafts(sharedState,blockDrafts)};globalThis.setValue=(k,v)=>eval(k+' = v');`,ctx);
 return {ctx,api:ctx.api,node,fields,windows,storage,set:(key,value)=>ctx.setValue(key,value),request:fn=>{ctx.mockRequest=fn;vm.runInContext('request=mockRequest',ctx);},input(path,value,type='text'){
  const key=ctx.api.keyFor(ctx.api.path(path));const el={dataset:{path,valuePath:ctx.api.keyFor(ctx.api.valuePath(path)),block:key,type},value};fields.push(el);node('#main').listeners.input({target:el});return key;
 },click(action,data={}){const button={dataset:{action,...data},disabled:false};return node('#main').listeners.click({target:{closest:selector=>selector==='[data-action]'?button:null}});}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function mockApi(h,initial=model.initialState()){
 let shared=structuredClone(initial),revision='r1';const posts=[];
 h.request(async(u,o)=>{if(!o)return {state:structuredClone(shared),revision};const body=JSON.parse(o.body);posts.push(body);validateState(body.state,shared.baseline);if(body.revision!==revision)throw Object.assign(new Error('409'),{status:409});shared=body.state;revision='r'+(posts.length+1);return {state:structuredClone(shared),revision};});
 return {posts,get:()=>shared,set(s){shared=structuredClone(s);revision+='next';}};
}
test('save one field retains another unsaved field and unrelated remote changes',async()=>{
 const h=harness(),net=mockApi(h);const k=h.input('weeks.0.team.status','mine status');h.input('weeks.0.team.requests','not shared');const fresh=model.initialState();fresh.weeks[0].team.issues='colleague';net.set(fresh);await h.api.saveBlock(k);
 assert.equal(net.posts.length,1);assert.equal(net.get().weeks[0].team.status,'mine status');assert.equal(net.get().weeks[0].team.requests,'');assert.equal(net.get().weeks[0].team.issues,'colleague');assert.equal(h.api.get().state.weeks[0].team.requests,'not shared');assert.equal(Object.keys(h.api.get().blockDrafts).length,1);
});
test('failed POST retry envelope is stable; duplicate clicks send only one request',async()=>{
 const h=harness(),wait=deferred(),sent=[];const key=h.input('weeks.0.team.status','draft');h.request(async(u,o)=>{if(!o)return {state:model.initialState(),revision:'r1'};sent.push(o.body);return wait.promise;});const first=h.api.saveBlock(key);await Promise.resolve();await Promise.resolve();await h.api.saveBlock(key);assert.equal(sent.length,1);wait.reject(new Error('offline'));await first;assert.ok(h.api.get().blockDrafts[key].pendingSave);assert.equal(h.api.get().state.weeks[0].team.status,'draft');
 h.request(async(u,o)=>{assert.ok(o);sent.push(o.body);return {state:JSON.parse(o.body).state,revision:'r2'};});await h.api.saveBlock(key);assert.equal(sent[0],sent[1]);assert.equal(Object.keys(h.api.get().blockDrafts).length,0);
});
test('same field conflict requires a choice and can be exported with local alternative',async()=>{
 const h=harness(),net=mockApi(h),key=h.input('weeks.0.team.status','mine');const fresh=model.initialState();fresh.weeks[0].team.status='theirs';net.set(fresh);await h.api.saveBlock(key);assert.equal(net.posts.length,0);assert.equal(h.api.get().blockDrafts[key].conflicts.length,1);assert.equal(h.api.export().mine.weeks[0].team.status,'mine');
 await h.api.saveBlock(key);assert.equal(net.posts.length,0);await h.click('choose-conflict',{block:key,conflict:'0',choice:'mine'});await h.api.saveBlock(key);assert.equal(net.get().weeks[0].team.status,'mine');
});
test('409 from save race rebases and does not overwrite the winner',async()=>{
 const h=harness(),key=h.input('weeks.0.team.status','mine');let reads=0,posts=0;h.request(async(u,o)=>{if(o){posts++;throw Object.assign(new Error('409'),{status:409});}reads++;const state=model.initialState();if(reads>1)state.weeks[0].team.status='race winner';return {state,revision:'r'+reads};});await h.api.saveBlock(key);assert.equal(posts,1);assert.equal(h.api.get().blockDrafts[key].pendingSave,null);assert.equal(h.api.get().blockDrafts[key].conflicts[0].theirs,'race winner');
});
test('independent tab keys and storage events never replace current unsaved inputs',()=>{
 const storage=new Map(),a=harness(storage),b=harness(storage);a.input('weeks.0.team.status','tab A');b.input('weeks.0.team.status','tab B');assert.notEqual(a.api.getKey(),b.api.getKey());assert.equal(storage.size,2);a.windows.storage({key:b.api.getKey()});assert.equal(a.api.get().state.weeks[0].team.status,'tab A');assert.equal(a.api.get().availableDrafts.length,1);assert.match(storage.get(b.api.getKey()),/tab B/);
});
test('two tabs save independent fields and detect same-field conflict',async()=>{
 const a=harness(),b=harness();let shared=model.initialState(),revision='r1';const net=async(u,o)=>{if(!o)return {state:structuredClone(shared),revision};const body=JSON.parse(o.body);assert.equal(body.revision,revision);shared=body.state;revision+='x';return {state:structuredClone(shared),revision};};a.request(net);b.request(net);
 const ka=a.input('weeks.0.team.status','A'),kb=b.input('weeks.0.team.requests','B');await a.api.saveBlock(ka);await b.api.saveBlock(kb);assert.equal(shared.weeks[0].team.status,'A');assert.equal(shared.weeks[0].team.requests,'B');
 a.input('weeks.0.team.status','A second');b.input('weeks.0.team.status','B second');await a.api.saveBlock(ka);await b.api.saveBlock(ka);assert.equal(shared.weeks[0].team.status,'A second');assert.equal(b.api.get().blockDrafts[ka].conflicts.length,1);
});
test('refresh locks inputs while reading and preserves all draft alternatives',async()=>{
 const h=harness(),wait=deferred(),key=h.input('weeks.0.team.status','original');h.request(()=>wait.promise);const job=h.api.refreshShared();h.input('weeks.0.team.status','late');assert.equal(h.api.get().state.weeks[0].team.status,'original');const s=model.initialState();s.weeks[0].team.status='someone else';wait.resolve({state:s,revision:'r2'});await job;assert.equal(h.api.get().blockDrafts[key].conflicts[0].mine,'original');
});
test('failed storage cleanup does not turn completed shared save into failure',async()=>{
 const h=harness(),net=mockApi(h),k=h.input('weeks.0.team.status','saved');h.ctx.localStorage.removeItem=()=>{throw new Error('storage denied');};await h.api.saveBlock(k);assert.equal(net.posts.length,1);assert.equal(Object.keys(h.api.get().blockDrafts).length,0);assert.doesNotMatch(h.node('#toast').textContent,/保存できませんでした/);
});
test('other fields can be typed during save without losing their draft after completion',async()=>{
 const h=harness(),wait=deferred(),started=deferred(),k=h.input('weeks.0.team.status','save me');h.request(async(u,o)=>{if(o){started.resolve();return wait.promise;}return {state:model.initialState(),revision:'r1'};});const job=h.api.saveBlock(k);await started.promise;h.input('weeks.0.team.requests','typed meanwhile');const envelope=h.api.get().blockDrafts[k].pendingSave;wait.resolve({state:envelope.state,revision:'r2'});await job;assert.equal(h.api.get().state.weeks[0].team.requests,'typed meanwhile');assert.equal(h.api.get().sharedState.weeks[0].team.requests,'');
});
test('render escapes HTML and unsafe links; each predetermined text field has scoped save',()=>{
 const h=harness(),payload='<img src=x onerror="alert(1)">';h.input('weeks.0.team.status',payload);h.api.render();assert.ok(h.node('#main').innerHTML.includes('&lt;img'));assert.ok(!h.node('#main').innerHTML.includes(payload));assert.match(h.node('#main').innerHTML,/data-action="save-block"/);
 for(const u of ['javascript:alert(1)','data:text/html,x','//bad.invalid','https://user:password@example.com'])assert.equal(h.api.safeUrl(u),false);assert.equal(h.api.safeUrl('https://example.com'),true);
});
test('unrecorded history stays unrecorded and dispatch graph supports more than target',()=>{
 const h=harness();assert.match(h.api.history(),/立案 —件/);h.api.get().sharedState.weeks[0].metrics.asOf='2026-10-12T00:00:00Z';h.api.get().sharedState.weeks[0].metrics.dispatched=30;assert.doesNotMatch(h.api.dispatchChart(),/cy="-/);
});
test('server validation error unlocks only this block for correction',async()=>{
 const h=harness(),k=h.input('monthlyRevenue.0.actual','-1','number');h.request(async(u,o)=>{if(o)throw Object.assign(new Error('invalid revenue'),{status:400});return {state:model.initialState(),revision:'r1'};});await h.api.saveBlock(k);assert.equal(h.api.get().blockDrafts[k].pendingSave,null);assert.match(h.api.get().blockDrafts[k].error,/入力/);h.input('monthlyRevenue.0.actual','12','number');assert.equal(h.api.get().blockDrafts[k].mine.actual,12);
});
test('related missing initiative blocks article save without sending another local block',async()=>{
 const h=harness(),net=mockApi(h);await h.click('add-article');const key=h.input('articles.0.initiativeId','deleted');await h.api.saveBlock(key);assert.equal(net.posts.length,0);assert.match(h.api.get().blockDrafts[key].error,/関連施策/);
});
test('a saved historical field does not replace its old snapshots',async()=>{
 const seed=model.initialState();seed.weeks.push(model.createWeek('2026-10-19'));seed.weeks[0].metrics.teamCvr=2;seed.weeks[0].metrics.asOf='2026-10-12T00:00:00Z';const h=harness(new Map(),seed),net=mockApi(h,seed),key=h.input('weeks.0.team.status','past wording');await h.api.saveBlock(key);assert.equal(net.get().weeks[0].metrics.teamCvr,2);assert.equal(net.get().weeks[0].metrics.asOf,'2026-10-12T00:00:00Z');
});
test('every app import exists in shipped model',()=>{for(const name of readFileSync(new URL('../public/app.js',import.meta.url),'utf8').match(/^import \{([^}]+)\}/)[1].split(',').map(x=>x.trim()))assert.ok(name in model,name);});

test('unsaved text does not enter shared weekly history',()=>{const h=harness();h.input('weeks.0.team.status','unshared private draft');assert.doesNotMatch(h.api.history(),/unshared private draft/);});

test('partial AXAD import is explicitly scoped and reference text is escaped',()=>{const h=harness();h.set('importStatus',{populationComplete:false,asOf:'2026-10-09',note:'6記事は公開日未確認 <img src=x onerror=alert(1)>',references:[]});h.api.render();const html=h.node('#main').innerHTML;assert.match(html,/登録分のみ/);assert.match(html,/参考明細と算出根拠はローカル/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);assert.equal(h.api.get().state.articles.length,0);});
