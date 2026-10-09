import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as model from '../public/model.js';
import * as axadModel from '../public/axad-model.js';
import {validateState} from '../server/validation.mjs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*?;\n/gm,'').replace(/boot\(\)\.then\([^\n]+\);\s*$/,'');
function harness(storage=new Map(),seed=model.initialState()){
 const nodes=new Map(),fields=[],windows={};
 const element=()=>({disabled:false,style:{},dataset:{},classList:{toggle(){},add(){},remove(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},querySelector(sel){return sel==='input:invalid'?null:node(sel);},querySelectorAll(sel){return sel==='[data-block]'?fields:[];},focus(){},scrollIntoView(){},matches(){return false;}});
 function node(s){if(!nodes.has(s))nodes.set(s,element());return nodes.get(s);}
 const localStorage={setItem(k,v){storage.set(k,v);},getItem(k){return storage.get(k)||null;},removeItem(k){storage.delete(k);},get length(){return storage.size;},key(i){return [...storage.keys()][i]}};
 const ctx=vm.createContext({...model,...axadModel,structuredClone,Intl,Date,URL,Blob,AbortController,crypto:globalThis.crypto,console,setTimeout:()=>1,clearTimeout(){},confirm:()=>true,document:{querySelector:node,querySelectorAll:()=>[],body:element()},window:{addEventListener(t,f){windows[t]=f;}},IntersectionObserver:class{observe(){}},localStorage,seed});
 vm.runInContext(source+`\nstate=structuredClone(seed);sharedState=structuredClone(seed);activeWeek=seed.weeks[0].id;revision='r1';config={apiBase:'https://mock.invalid'};apiReady=true;editor='QA';globalThis.api={saveBlock,render,storeDraft,history,dispatchChart,report,initiativeDetails,articleSection,safeUrl,refreshShared,scanDrafts,downloadDraft,get:()=>({state,sharedState,revision,dirty,savingKey,syncing,blockDrafts,availableDrafts,axadData,importStatus}),path:inputBlockPath,valuePath:stableInputPath,keyFor,getKey:()=>OWN_DRAFT_KEY,export:()=>exportBlockDrafts(sharedState,blockDrafts)};globalThis.setValue=(k,v)=>eval(k+' = v');`,ctx);
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
 const h=harness(),k=h.input('weeks.0.team.status','invalid');h.request(async(u,o)=>{if(o)throw Object.assign(new Error('invalid revenue'),{status:400});return {state:model.initialState(),revision:'r1'};});await h.api.saveBlock(k);assert.equal(h.api.get().blockDrafts[k].pendingSave,null);assert.match(h.api.get().blockDrafts[k].error,/入力/);h.input('weeks.0.team.status','corrected');assert.equal(h.api.get().blockDrafts[k].mine,'corrected');
});
test('related missing initiative blocks article save without sending another local block',async()=>{
 const h=harness(),net=mockApi(h);await h.click('add-article');const key=h.input('articles.0.initiativeId','deleted');await h.api.saveBlock(key);assert.equal(net.posts.length,0);assert.match(h.api.get().blockDrafts[key].error,/関連施策/);
});
test('a saved historical field does not replace its old snapshots',async()=>{
 const seed=model.initialState();seed.weeks.push(model.createWeek('2026-10-19'));seed.weeks[0].metrics.teamCvr=2;seed.weeks[0].metrics.asOf='2026-10-12T00:00:00Z';const h=harness(new Map(),seed),net=mockApi(h,seed),key=h.input('weeks.0.team.status','past wording');await h.api.saveBlock(key);assert.equal(net.get().weeks[0].metrics.teamCvr,2);assert.equal(net.get().weeks[0].metrics.asOf,'2026-10-12T00:00:00Z');
});
test('every app import exists in shipped model',()=>{for(const name of readFileSync(new URL('../public/app.js',import.meta.url),'utf8').match(/^import \{([^}]+)\}/)[1].split(',').map(x=>x.trim()))assert.ok(name in model,name);});

test('unsaved text does not enter shared weekly history',()=>{const h=harness();h.input('weeks.0.team.status','unshared private draft');assert.doesNotMatch(h.api.history(),/unshared private draft/);});

test('partial AXAD import stays scoped without displaying the removed import notice',()=>{const h=harness();h.set('importStatus',{populationComplete:false,asOf:'2026-10-09',note:'6記事は公開日未確認 <img src=x onerror=alert(1)>',references:[]});h.api.render();const html=h.node('#main').innerHTML;assert.match(html,/登録分のみ/);assert.doesNotMatch(html,/参考明細と算出根拠はローカル|AXAD取得 ·/);assert.doesNotMatch(html,/<img src=x/);assert.equal(h.api.get().state.articles.length,0);});

test('numeric import does not turn unrecorded initiative counts into confirmed zero',()=>{const seed=model.initialState();seed.weeks[0].metrics.asOf='2026-10-09T04:08:59Z';seed.weeks[0].metrics.teamCvr=1.37;const h=harness(new Map(),seed);h.api.render();assert.match(h.node('#main').innerHTML,/優先度会議に上がった施策<\/span><strong><span class="unrecorded">未登録/);assert.match(h.api.history(),/立案 —件/);assert.match(h.api.dispatchChart(),/配信までの進捗が蓄積/);});

test('AXAD revenue and its collection date remain visible without manual inputs',()=>{
 const seed=model.initialState();seed.monthlyRevenue[0].actual=152951325;seed.monthlyRevenue[0].asOf='2026-10-09';const h=harness(new Map(),seed);h.api.render();const html=h.node('#main').innerHTML;
 assert.match(html,/1\.53/);assert.match(html,/10\/9時点/);assert.match(html,/AXAD.*週次/);assert.doesNotMatch(html,/data-path="monthlyRevenue\./);assert.doesNotMatch(html,/この月の売上を保存|実績を入力/);assert.deepEqual(h.api.get().state.monthlyRevenue,seed.monthlyRevenue);
});

test('missing AXAD revenue is described as uncollected rather than a request for input',()=>{
 const h=harness();h.api.render();const html=h.node('#main').innerHTML;assert.match(html,/未集計/);assert.doesNotMatch(html,/実績を入力|売上の入力|未入力は描画/);
});

test('strategy section and navigation are removed while saved qualitative history survives',()=>{
 const seed=model.initialState();seed.weeks[0].qualitative[0].evidence='既存の証拠を保持';const h=harness(new Map(),seed);h.api.render();const html=h.node('#main').innerHTML;
 assert.doesNotMatch(html,/id="strategy"|戦略と仕組み/);const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');assert.doesNotMatch(index,/href="#strategy"|戦略と仕組み/);assert.match(html,/既存の証拠を保持/);assert.match(html,/<span class="number">04<\/span>施策の進行/);assert.deepEqual(h.api.get().state.weeks[0].qualitative,seed.weeks[0].qualitative);
});

test('historical revenue keeps its snapshot and has no manual entry controls',()=>{
 const seed=model.initialState();seed.weeks[0].metrics.monthlyRevenue=[{month:'2026-10',actual:100000000,asOf:'2026-10-08'}];seed.weeks.push(model.createWeek('2026-10-19'));seed.monthlyRevenue[0].actual=200000000;const h=harness(new Map(),seed);h.api.render();const html=h.node('#main').innerHTML;
 assert.match(html,/1\.00<small>億円/);assert.match(html,/10\/8時点/);assert.match(html,/保存時点のAXAD実績/);assert.doesNotMatch(html,/data-path="monthlyRevenue\.|売上の入力/);assert.deepEqual(h.api.get().state.weeks[0].metrics.monthlyRevenue,seed.weeks[0].metrics.monthlyRevenue);
});

function performanceSeed(){const seed=model.initialState();seed.articles=[{id:'axad-203',title:'検証記事',owner:'usukura',releaseDate:'2026-10-07',observedThrough:'2026-10-09',metaCv:4,metaClicks:121,initiativeId:null}];seed.weeks[0].metrics.asOf='2026-10-09T04:00:00Z';seed.weeks[0].metrics.teamCvr=1.3;return seed;}
function performanceData(seed){return {media:'META',asOf:'2026-10-09',articles:seed.articles.map(a=>({...a,metrics:{spend:43333,impressions:5000,clicks:121,mcv:32,cv:4,revenue:80000,profit:-100}})),trend:{basis:'article_mean',september:[{releaseStart:'2026-09-01',releaseEnd:'2026-09-06',observedThrough:'2026-09-06',teamCvr:1,eligibleArticles:2,people:{usukura:1}}],quarter:[{releaseStart:'2026-10-01',releaseEnd:'2026-10-09',observedThrough:'2026-10-09',teamCvr:2,eligibleArticles:7,people:{usukura:2}}]}};}
test('AXAD performance tables show all columns and total ratios while numeric fields stay read-only',()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed);h.set('axadData',performanceData(seed));h.api.render();const html=h.node('#main').innerHTML;const section=html.slice(html.indexOf('<section id="articles"'),html.indexOf('<section id="members"'));
 const headers=['記事名','消化金額','MCV','CV','売上','利益','ROAS','CPA','CPM','Imp','Clicks','CTR','CPC','MCVR','MCPA','CVR','実質CVR'];let position=-1;for(const label of headers){const next=section.indexOf('>'+label+'</th>',position+1);assert.ok(next>position,label);position=next;}
 assert.match(section,/12\.50%/);assert.match(section,/3\.31%/);assert.match(section,/negative/);assert.match(section,/合計/);assert.match(section,/data-path="articles\.0\.title"/);assert.doesNotMatch(section,/data-path="articles\.0\.(metaCv|metaClicks|observedThrough)"/);assert.doesNotMatch(section,/href="(?:#|javascript:)/);
});
test('unmatched metadata never displays another article raw numbers',()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed),data=performanceData(seed);data.articles[0].title='別の記事';h.set('axadData',data);const html=h.api.articleSection(seed.weeks[0]);assert.match(html,/未照合/);assert.doesNotMatch(html,/43,333|80,000|12\.50%/);
});
test('historical article detail requires matching historical observation date',()=>{
 const seed=performanceSeed();seed.weeks[0].metrics.asOf='2026-10-08T04:00:00Z';seed.weeks.push(model.createWeek('2026-10-19'));const h=harness(new Map(),seed);h.set('axadData',performanceData(seed));const html=h.api.articleSection(seed.weeks[0]);assert.match(html,/当時詳細未取得/);assert.doesNotMatch(html,/43,333|80,000/);
});
test('September weekly cumulative chart is separated from quarter and preserves report links',()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed);h.set('axadData',performanceData(seed));h.api.render();const html=h.node('#main').innerHTML;assert.match(html,/9\/6/);assert.match(html,/10\/9/);assert.match(html,/3Q開始/);assert.match(html,/対象リリース/);assert.match(html,/観測日/);assert.match(html,/初回19記事/);assert.doesNotMatch(html,/#week-2026-09/);assert.match(html,/#week-2026-10-12/);
});


test('metadata save preserves fresh AXAD numbers even with a legacy article draft',async()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed),net=mockApi(h,seed),key=h.input('articles.0.title','改名');h.input('weeks.0.team.requests','未保存の相談');const d=h.api.get().blockDrafts[key];d.mine.metaCv=1;d.mine.metaClicks=2;d.mine.observedThrough='2026-10-08';const fresh=structuredClone(seed);fresh.articles[0].metaCv=5;fresh.articles[0].metaClicks=130;fresh.monthlyRevenue[0].actual=152951325;net.set(fresh);await h.api.saveBlock(key);
 assert.equal(net.posts.length,1);assert.equal(net.get().articles[0].metaCv,5);assert.equal(net.get().articles[0].metaClicks,130);assert.equal(net.get().articles[0].observedThrough,'2026-10-09');assert.equal(net.get().articles[0].title,'改名');assert.equal(h.api.get().state.weeks[0].team.requests,'未保存の相談');assert.equal(net.get().monthlyRevenue[0].actual,152951325);
});
test('old pending envelopes are kept from replaying AXAD numbers and can be rebased on a later save',async()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed),net=mockApi(h,seed),key=h.input('weeks.0.team.status','再保存');const d=h.api.get().blockDrafts[key],old=structuredClone(seed);old.articles[0].metaCv=1;old.monthlyRevenue[0].actual=1;d.pendingSave={state:old,revision:'r1',requestId:'legacy-request',editor:'QA'};
 await h.api.saveBlock(key);assert.equal(net.posts.length,0);assert.equal(d.pendingSave,null);assert.match(d.error,/古い保存/);await h.api.saveBlock(key);assert.equal(net.posts.length,1);assert.equal(net.get().articles[0].metaCv,4);assert.equal(net.get().monthlyRevenue[0].actual,null);assert.equal(net.get().weeks[0].team.status,'再保存');
});
test('legacy revenue drafts cannot save and new articles begin without AXAD measurements',async()=>{
 const h=harness(),net=mockApi(h);const path=['monthlyRevenue',{key:'month',id:'2026-10'}],key=h.api.keyFor(path),draft=model.makeBlockDraft(h.api.get().sharedState,path);draft.mine.actual=1;h.api.get().blockDrafts[key]=draft;await h.api.saveBlock(key);assert.equal(net.posts.length,0);assert.match(draft.error,/AXAD/);await h.click('add-article');const a=h.api.get().state.articles[0];assert.equal(a.metaCv,null);assert.equal(a.metaClicks,null);assert.equal(a.observedThrough,null);
});

test('later text and initiative saves keep AXAD observation time while counts use current records',async()=>{
 const seed=performanceSeed();seed.initiatives=[{id:'i1',title:'施策',owner:'aoki',stage:'idea',meetingDate:null,dispatchDate:null,deadline:null,evidence:'',background:'',craft:'',feedback:'',learning:'',next:'',url:''}];const h=harness(new Map(),seed),net=mockApi(h,seed);
 h.ctx.Date=class extends Date{constructor(value){super(value===undefined?'2026-10-12T00:00:00Z':value);}};
 const key=h.input('initiatives.0.meetingDate','2026-10-12','date');await h.api.saveBlock(key);const m=net.get().weeks[0].metrics;assert.equal(m.asOf,'2026-10-09T04:00:00.000Z');assert.equal(m.people.aoki.proposals,1);assert.equal(m.teamCvr,4/121*100);const text=h.input('weeks.0.team.status','月曜の報告');await h.api.saveBlock(text);assert.equal(net.get().weeks[0].metrics.asOf,m.asOf);assert.equal(axadModel.trendPoints(null,net.get().weeks).length,1);assert.equal(axadModel.trendPoints(null,net.get().weeks)[0].observedThrough,'2026-10-09');
});

test('imported observation timestamp is normalized to UTC and uncollected metrics remain null',async()=>{
 const seed=performanceSeed();seed.weeks[0].metrics.asOf=null;const h=harness(new Map(),seed),net=mockApi(h,seed),data=performanceData(seed);data.fetchedAtJst='2026-10-09T15:59:45+09:00';h.set('axadData',data);await h.api.saveBlock(h.input('weeks.0.team.status','保存'));assert.equal(net.get().weeks[0].metrics.asOf,'2026-10-09T06:59:45.000Z');
 const blank=harness(),blankNet=mockApi(blank);await blank.api.saveBlock(blank.input('weeks.0.team.status','数値未取得'));assert.equal(blankNet.get().weeks[0].metrics.asOf,null);assert.equal(axadModel.trendPoints(null,blankNet.get().weeks).length,0);
});

test('refresh rereads AXAD raw values and metadata together while preserving local text',async()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed),old=performanceData(seed);old.fetchedAtJst='2026-10-09T13:08:59+09:00';h.set('axadData',old);h.input('weeks.0.team.requests','未保存の相談');const fresh=structuredClone(seed);fresh.articles[0].metaCv=5;const raw=performanceData(fresh);raw.articles[0].metrics.cv=5;raw.schemaVersion=1;raw.fetchedAtJst='2026-10-09T15:59:45+09:00';raw.notes=['最新の取得注記'];raw.populationComplete=false;let reads=0;h.request(async url=>{if(url==='./axad-data.json'){reads++;return raw;}return {state:fresh,revision:'r2'};});await h.api.refreshShared();h.api.render();const html=h.node('#main').innerHTML;assert.equal(reads,1);assert.equal(h.api.get().importStatus.fetchedAtJst,'2026-10-09T15:59:45+09:00');assert.equal(h.api.get().importStatus.note,'最新の取得注記');assert.doesNotMatch(html,/13:08:59|AXAD取得 ·/);assert.match(html,/15\.63%/);assert.equal(h.api.get().state.weeks[0].team.requests,'未保存の相談');
 h.request(async url=>{if(url==='./axad-data.json')throw new Error('failed raw');return {state:fresh,revision:'r3'};});await h.api.refreshShared();assert.match(h.node('#main').innerHTML,/AXAD詳細未取得/);assert.doesNotMatch(h.node('#main').innerHTML,/15\.63%/);
});

test('legacy numeric conflicts do not block metadata while title conflicts still require a choice',async()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed),net=mockApi(h,seed),key=h.input('articles.0.title','改名'),d=h.api.get().blockDrafts[key];d.mine.metaCv=1;d.conflicts=[{path:['articles',{key:'id',id:seed.articles[0].id},'metaCv'],mine:1,theirs:4}];await h.api.saveBlock(key);assert.equal(net.posts.length,1);assert.equal(net.get().articles[0].metaCv,4);assert.equal(net.get().articles[0].title,'改名');
 const second=h.input('articles.0.title','別名'),next=h.api.get().blockDrafts[second];next.conflicts=[{path:['articles',{key:'id',id:seed.articles[0].id},'title'],mine:'別名',theirs:'競合名'}];await h.api.saveBlock(second);assert.equal(net.posts.length,1);assert.equal(next.conflicts.length,1);
});

test('saving a newer report week does not invent a later AXAD observation point or alter old metrics',async()=>{
 const seed=performanceSeed();seed.weeks.push(model.createWeek('2026-10-19'));const old=structuredClone(seed.weeks[0].metrics),h=harness(new Map(),seed),net=mockApi(h,seed);h.ctx.Date=class extends Date{constructor(value){super(value===undefined?'2026-10-19T00:00:00Z':value);}};await h.api.saveBlock(h.input('weeks.1.team.status','新しい報告'));assert.deepEqual(net.get().weeks[0].metrics,old);assert.equal(net.get().weeks[1].metrics.asOf,'2026-10-09T04:00:00.000Z');const points=axadModel.trendPoints(null,net.get().weeks);assert.equal(points.length,1);assert.equal(points[0].observedThrough,'2026-10-09');assert.equal(points[0].week,'2026-10-12');
});
