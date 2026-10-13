import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as model from '../public/model.js';
import * as axadModel from '../public/axad-model.js';
import {validateState} from '../server/validation.mjs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*?;\n/gm,'').replace(/boot\(\)(?:\.then\([^\n]+\))?;\s*$/,'');
function harness(storage=new Map(),seed=model.initialState()){
 const nodes=new Map(),fields=[],reviewFields=[],reviewBadges=[],windows={};
 const element=()=>({disabled:false,style:{},dataset:{},attributes:{},setAttribute(key,value){this.attributes[key]=value;},classList:{toggle(){},add(){},remove(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},querySelector(sel){return sel==='input:invalid'?null:node(sel);},querySelectorAll(sel){return sel==='[data-block]'?fields:sel==='[data-review-key]'?reviewFields:sel==='[data-review-rating-badge]'?reviewBadges:[];},focus(){},scrollIntoView(options){this.scrolled=options;},matches(){return false;}});
 function node(s){if(!nodes.has(s))nodes.set(s,element());return nodes.get(s);}
 const localStorage={setItem(k,v){storage.set(k,v);},getItem(k){return storage.get(k)||null;},removeItem(k){storage.delete(k);},get length(){return storage.size;},key(i){return [...storage.keys()][i]}};
 const ctx=vm.createContext({...model,...axadModel,structuredClone,Intl,Date,URL,Blob,AbortController,crypto:globalThis.crypto,console,setTimeout:()=>1,clearTimeout(){},confirm:()=>true,document:{querySelector:node,querySelectorAll:()=>[],body:element()},window:{addEventListener(t,f){windows[t]=f;}},IntersectionObserver:class{observe(){}},localStorage,seed});
 vm.runInContext(source+`\nstate=structuredClone(seed);sharedState=structuredClone(seed);activeWeek=seed.weeks[0].id;revision='r1';config={apiBase:'https://mock.invalid'};apiReady=true;editor='QA';globalThis.api={saveBlock,render,storeDraft,history,dispatchChart,report,initiativeDetails,articleSection,safeUrl,refreshShared,scanDrafts,downloadDraft,get:()=>({state,sharedState,revision,dirty,savingKey,syncing,blockDrafts,availableDrafts,axadData,importStatus,articleLinks}),path:inputBlockPath,valuePath:stableInputPath,keyFor,getKey:()=>OWN_DRAFT_KEY,export:()=>exportBlockDrafts(sharedState,blockDrafts)};globalThis.setValue=(k,v)=>eval(k+' = v');`,ctx);
 return {ctx,api:ctx.api,node,fields,windows,storage,set:(key,value)=>ctx.setValue(key,value),request:fn=>{ctx.mockRequest=fn;vm.runInContext('request=mockRequest',ctx);},input(path,value,type='text'){
  const key=ctx.api.keyFor(ctx.api.path(path));const el={dataset:{path,valuePath:ctx.api.keyFor(ctx.api.valuePath(path)),block:key,type},value};fields.push(el);node('#main').listeners.input({target:el});return key;
 },reviewInput(key,field,value){const el={dataset:{reviewKey:key,reviewField:field},value};reviewFields.push(el);node('#main').listeners.input({target:el});return el;},reviewBadge(key){const el=element();el.dataset.reviewRatingBadge=key;reviewBadges.push(el);return el;},click(action,data={}){const button={dataset:{action,...data},disabled:false};return node('#main').listeners.click({target:{closest:selector=>selector==='[data-action]'?button:null}});}};
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
 const h=harness();assert.match(h.api.history(),/立案 —件/);h.api.get().sharedState.weeks[0].metrics.asOf='2026-10-12T00:00:00Z';h.api.get().sharedState.weeks[0].metrics.dispatched=30;const html=h.api.dispatchChart();assert.match(html,/^<details class="card baseline-card"><summary>配信進捗の変遷<\/summary>/);assert.doesNotMatch(html,/<details[^>]*\bopen\b/);assert.equal(html.split('配信進捗の変遷').length-1,1);assert.match(html,/<svg class="chart dispatch-chart"/);assert.match(html,/配信日が10\/1〜12\/31の施策を集計/);assert.doesNotMatch(html,/cy="-/);
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

test('unsaved report text is shown for editing but never enters the saved weekly summary',()=>{const h=harness();h.input('weeks.0.team.status','unshared private draft');const html=h.api.history();assert.doesNotMatch(html.match(/<summary>[\s\S]*?<\/summary>/)[0],/unshared private draft/);assert.match(html,/unshared private draft/);assert.equal(h.api.get().sharedState.weeks[0].team.status,'');});

test('partial AXAD import stays scoped without displaying the removed import notice',()=>{const h=harness();h.set('importStatus',{populationComplete:false,asOf:'2026-10-09',note:'6記事は公開日未確認 <img src=x onerror=alert(1)>',references:[]});h.api.render();const html=h.node('#main').innerHTML;assert.match(html,/<span class="label-tag kgi">KGI<\/span>/);for(const label of ['KPI01','KPI02'])assert.match(html,new RegExp('<span class="label-tag kpi">'+label+'</span>'));assert.match(html,/記事ごとの単純平均（登録分のみ）/);assert.doesNotMatch(html,/<span class="label-tag[^"]*">登録分のみ/);assert.doesNotMatch(html,/参考明細と算出根拠はローカル|AXAD取得 ·/);assert.doesNotMatch(html,/<img src=x/);assert.equal(h.api.get().state.articles.length,0);});

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
 assert.doesNotMatch(html,/id="strategy"|戦略と仕組み/);const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');assert.doesNotMatch(index,/href="#strategy"|戦略と仕組み/);assert.match(html,/既存の証拠を保持/);assert.match(html,/<span class="number">05<\/span>前週リリース記事の振り返り/);assert.deepEqual(h.api.get().state.weeks[0].qualitative,seed.weeks[0].qualitative);
});

test('historical revenue keeps its snapshot and has no manual entry controls',()=>{
 const seed=model.initialState();seed.weeks[0].metrics.monthlyRevenue=[{month:'2026-10',actual:100000000,asOf:'2026-10-08'}];seed.weeks.push(model.createWeek('2026-10-19'));seed.monthlyRevenue[0].actual=200000000;const h=harness(new Map(),seed);h.api.render();const html=h.node('#main').innerHTML;
 assert.match(html,/10月 1\.00億円/);assert.match(html,/10\/8時点/);assert.match(html,/集計/);assert.doesNotMatch(html,/data-path="monthlyRevenue\.|売上の入力/);assert.deepEqual(h.api.get().state.weeks[0].metrics.monthlyRevenue,seed.weeks[0].metrics.monthlyRevenue);
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
 const seed=performanceSeed(),h=harness(new Map(),seed),old=performanceData(seed);old.fetchedAtJst='2026-10-09T13:08:59+09:00';h.set('axadData',old);h.input('weeks.0.team.requests','未保存の相談');const fresh=structuredClone(seed);fresh.articles[0].metaCv=5;const raw=performanceData(fresh);raw.articles[0].metrics.cv=5;raw.schemaVersion=1;raw.fetchedAtJst='2026-10-09T15:59:45+09:00';raw.notes=['最新の取得注記'];raw.populationComplete=false;let reads=0;h.request(async url=>{if(url==='./axad-data.json'){reads++;return raw;}if(url==='./article-links.json')return {schemaVersion:1,articles:[{id:fresh.articles[0].id,title:fresh.articles[0].title,url:'https://example.com/ab/refreshed'}]};return {state:fresh,revision:'r2'};});await h.api.refreshShared();h.api.render();const html=h.node('#main').innerHTML;assert.equal(reads,1);assert.equal(h.api.get().importStatus.fetchedAtJst,'2026-10-09T15:59:45+09:00');assert.equal(h.api.get().importStatus.note,'最新の取得注記');assert.doesNotMatch(html,/13:08:59|AXAD取得 ·/);assert.match(html,/15\.63%/);assert.match(html,/href="https:\/\/example.com\/ab\/refreshed"/);assert.equal(h.api.get().state.weeks[0].team.requests,'未保存の相談');
 h.request(async url=>{if(url==='./axad-data.json'||url==='./article-links.json')throw new Error('failed reference');return {state:fresh,revision:'r3'};});await h.api.refreshShared();assert.match(h.node('#main').innerHTML,/AXAD詳細未取得/);assert.doesNotMatch(h.node('#main').innerHTML,/15\.63%|class="article-title-link"/);
});

test('legacy numeric conflicts do not block metadata while title conflicts still require a choice',async()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed),net=mockApi(h,seed),key=h.input('articles.0.title','改名'),d=h.api.get().blockDrafts[key];d.mine.metaCv=1;d.conflicts=[{path:['articles',{key:'id',id:seed.articles[0].id},'metaCv'],mine:1,theirs:4}];await h.api.saveBlock(key);assert.equal(net.posts.length,1);assert.equal(net.get().articles[0].metaCv,4);assert.equal(net.get().articles[0].title,'改名');
 const second=h.input('articles.0.title','別名'),next=h.api.get().blockDrafts[second];next.conflicts=[{path:['articles',{key:'id',id:seed.articles[0].id},'title'],mine:'別名',theirs:'競合名'}];await h.api.saveBlock(second);assert.equal(net.posts.length,1);assert.equal(next.conflicts.length,1);
});

test('saving a newer report week does not invent a later AXAD observation point or alter old metrics',async()=>{
 const seed=performanceSeed();seed.weeks.push(model.createWeek('2026-10-19'));const old=structuredClone(seed.weeks[0].metrics),h=harness(new Map(),seed),net=mockApi(h,seed);h.ctx.Date=class extends Date{constructor(value){super(value===undefined?'2026-10-19T00:00:00Z':value);}};await h.api.saveBlock(h.input('weeks.1.team.status','新しい報告'));assert.deepEqual(net.get().weeks[0].metrics,old);assert.equal(net.get().weeks[1].metrics.asOf,'2026-10-09T04:00:00.000Z');const points=axadModel.trendPoints(null,net.get().weeks);assert.equal(points.length,1);assert.equal(points[0].observedThrough,'2026-10-09');assert.equal(points[0].week,'2026-10-12');
});


test('only real weeks appear, newest starts open and opening another week keeps separate drafts',()=>{
 const seed=model.initialState();seed.weeks.push(model.createWeek('2026-10-19'));const h=harness(new Map(),seed);h.api.render();let html=h.node('#main').innerHTML;assert.match(html,/data-week-fold="2026-10-19" open/);assert.match(html,/data-week-fold="2026-10-12" >/);assert.equal((html.match(/data-week-fold=/g)||[]).length,2);assert.ok(html.indexOf('id="overview"')<html.indexOf('data-week-fold='));assert.doesNotMatch(html,/id="week-selector"|data-section-fold=/);assert.match(html,/10月第3週/);assert.match(html,/10\/12〜10\/18/);
 h.input('weeks.0.team.change','過去週の下書き');h.input('weeks.1.team.change','最新週の下書き');h.node('#main').listeners.toggle({target:{dataset:{weekFold:'2026-10-12'},open:true}});h.node('#main').listeners.toggle({target:{dataset:{weekFold:'2026-10-19'},open:false}});h.api.render();html=h.node('#main').innerHTML;assert.match(html,/data-week-fold="2026-10-12" open/);assert.match(html,/data-week-fold="2026-10-19" >/);assert.equal(h.api.get().state.weeks[0].team.change,'過去週の下書き');assert.equal(h.api.get().state.weeks[1].team.change,'最新週の下書き');h.node('#main').listeners.toggle({target:{dataset:{weekFold:'2026-10-19'},open:true}});h.api.render();assert.match(h.node('#main').innerHTML,/最新週の下書き/);
});
test('chart history links still open their target week and each report has a unique id without sidebar bindings',async()=>{
 const seed=model.initialState();seed.weeks.push(model.createWeek('2026-10-19'));const h=harness(new Map(),seed);h.api.render();h.node('#main').listeners.toggle({target:{dataset:{weekFold:'2026-10-12'},open:false}});h.node('#week-2026-10-12').open=false;const jump={dataset:{jumpWeek:'2026-10-12'}};await h.node('#main').listeners.click({target:{closest:selector=>selector==='[data-jump-week]'?jump:null}});assert.equal(h.node('#week-2026-10-12').open,true);h.api.render();const html=h.node('#main').innerHTML;assert.match(html,/data-week-fold="2026-10-12" open/);assert.equal((html.match(/id="report"/g)||[]).length,1);assert.match(html,/id="report-2026-10-12"/);const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');assert.doesNotMatch(index,/<aside|class="sidebar"/);assert.match(index,/header-clock/);
});
test('add button creates a draft inside the latest week without altering week disclosure states',async()=>{
 const h=harness();h.api.render();h.input('weeks.0.team.requests','未保存の相談');await h.click('add-article');assert.match(h.node('#main').innerHTML,/data-week-fold="2026-10-12" open/);assert.equal(h.api.get().state.articles.length,1);assert.equal(h.api.get().state.weeks[0].team.requests,'未保存の相談');
});
test('team report has three single labels and hides requests and issues while retaining the original state',()=>{
 const seed=model.initialState();seed.weeks[0].team.issues='保存済みの記事課題';seed.weeks[0].team.requests='保存済みの相談・判断依頼';const h=harness(new Map(),seed),html=h.api.report(seed.weeks[0],0);for(const label of ['今の状態・結論','前週からの変化・その理由','今週の優先事項'])assert.equal(html.split(label).length-1,1,label);for(const field of ['status','change','priorities'])assert.match(html,new RegExp('data-path="weeks.0.team.'+field+'"'));assert.match(html,/class="report-main"/);assert.match(html,/class="report-aside"/);assert.doesNotMatch(html,/PC局への相談・判断依頼|保存済みの相談・判断依頼|team\.requests|記事が課題|案件課題|team\.issues/);assert.doesNotMatch(h.api.history(),/保存済みの記事課題|案件課題/);assert.equal(h.api.get().state.weeks[0].team.issues,'保存済みの記事課題');assert.equal(h.api.get().state.weeks[0].team.requests,'保存済みの相談・判断依頼');
});
test('past weeks display saved measurements and never reuse current global initiative or article tables',()=>{
 const seed=performanceSeed();seed.weeks.push(model.createWeek('2026-10-19'));const h=harness(new Map(),seed);h.set('axadData',performanceData(seed));h.api.render();const html=h.node('#main').innerHTML,past=html.slice(html.indexOf('id="week-2026-10-12"'));assert.match(past,/記事の当時の詳細データは未保存/);assert.match(past,/保存時のCVR/);assert.match(past,/data-path="weeks.0.members.aoki.reflection"/);assert.doesNotMatch(past,/performance-table|data-action="add-article"|id="articles"|id="members"/);assert.equal((html.match(/id="articles"/g)||[]).length,1);assert.equal((html.match(/id="members"/g)||[]).length,1);
});

test('old three-field reviews migrate to unrated and invalid stored ratings preserve note text',()=>{
 const seed=performanceSeed(),key=encodeURIComponent(JSON.stringify([seed.weeks[0].id,seed.articles[0].id])),prefix='article-team-q3-2026-article-review-v1-';
 for(const rating of [undefined,'invalid','◯','<img src=x onerror=alert(1)>']){
  const storage=new Map([[prefix+key,JSON.stringify({schemaVersion:1,fields:{result:'昔の結果',analysis:'昔の考察',next:'昔のネクスト',...(rating===undefined?{}:{rating})}})]]),h=harness(storage,seed);h.api.render();const html=h.node('#main').innerHTML;
  assert.match(html,/<select[^>]+data-review-field="rating"[^>]*><option value="" selected>未評価<\/option>/);assert.match(html,/昔の結果/);assert.match(html,/昔の考察/);assert.match(html,/昔のネクスト/);assert.doesNotMatch(html,/下書きを読み込めません|<img src=x/);h.reviewInput(key,'rating','good');const saved=JSON.parse(storage.get(prefix+key));assert.equal(saved.fields.rating,'good');assert.equal(saved.fields.result,'昔の結果');
 }
});

test('manual ratings sync selectors and row badges, persist by week and never enter shared POST',async()=>{
 const seed=performanceSeed(),storage=new Map(),h=harness(storage,seed),net=mockApi(h,seed),key=h.api.keyFor([seed.weeks[0].id,seed.articles[0].id]);h.api.render();const first=h.reviewInput(key,'rating',''),badges=[h.reviewBadge(key),h.reviewBadge(key)];
 for(const [value,label] of [['good','◯'],['caution','△'],['bad','×'],['','—']]){
  h.reviewInput(key,'rating',value);assert.equal(first.value,value);assert.equal(first.dataset.reviewRating,value);for(const badge of badges){assert.equal(badge.textContent,label);assert.equal(badge.dataset.reviewRating,value);assert.equal(badge.attributes['aria-label'],'評価：'+(value?label:'未評価'));}
 }
 h.reviewInput(key,'rating','good');await h.click('toggle-review',{reviewKey:key});await h.click('toggle-review',{reviewKey:key});h.api.render();let html=h.node('#main').innerHTML;assert.equal((html.match(/data-review-rating-badge=/g)||[]).length,2);assert.equal((html.match(/data-review-rating="good" aria-label="評価：◯">◯<\/span>/g)||[]).length,2);assert.match(html,/<option value="good" selected>◯<\/option>/);assert.ok(html.indexOf('data-review-field="rating"')<html.indexOf('data-review-field="result"'));assert.match(html,/data-review-panel="[^\"]+" hidden/);assert.doesNotMatch(html.slice(html.indexOf('<tfoot>'),html.indexOf('</tfoot>')),/rating/);
 const reloaded=harness(storage,seed);reloaded.api.render();assert.match(reloaded.node('#main').innerHTML,/<option value="good" selected>◯<\/option>/);const otherSeed=structuredClone(seed);otherSeed.weeks=[model.createWeek('2026-10-19')];const other=harness(storage,otherSeed);other.api.render();assert.doesNotMatch(other.node('#main').innerHTML,/<option value="good" selected>/);
 await h.api.saveBlock(h.input('weeks.0.team.status','共有報告'));assert.equal(net.posts.length,1);assert.doesNotMatch(JSON.stringify(net.posts),/rating|"good"/);assert.equal(h.api.get().state.articles[0].metaCv,4);
});

test('invalid manual ratings cannot overwrite the selected rating or note text',()=>{
 const seed=performanceSeed(),storage=new Map(),h=harness(storage,seed),key=h.api.keyFor([seed.weeks[0].id,seed.articles[0].id]);h.api.render();h.reviewInput(key,'result','既存結果');h.reviewInput(key,'rating','caution');const before=storage.get('article-team-q3-2026-article-review-v1-'+key);
 for(const invalid of ['other','◯','__proto__','<img src=x>']){const el=h.reviewInput(key,'rating',invalid);assert.equal(el.value,'caution');assert.equal(storage.get('article-team-q3-2026-article-review-v1-'+key),before);}h.api.render();assert.match(h.node('#main').innerHTML,/<option value="caution" selected>△<\/option>/);assert.match(h.node('#main').innerHTML,/既存結果/);assert.equal(Object.keys(h.api.get().blockDrafts).length,0);
});

test('article row review toggles preserve notes through rerender and reload, scoped by report week',async()=>{
 const seed=performanceSeed(),storage=new Map(),h=harness(storage,seed),key=h.api.keyFor([seed.weeks[0].id,seed.articles[0].id]);h.api.render();await h.click('toggle-review',{reviewKey:key});h.reviewInput(key,'result','結果の下書き');await h.click('toggle-review',{reviewKey:key});h.api.render();assert.match(h.node('#main').innerHTML,/data-review-panel="[^\"]+" hidden/);await h.click('toggle-review',{reviewKey:key});h.api.render();assert.match(h.node('#main').innerHTML,/結果の下書き/);assert.match(h.node('#main').innerHTML,/この端末の下書き（共有保存は未対応）/);
 const reloaded=harness(storage,seed);reloaded.api.render();assert.match(reloaded.node('#main').innerHTML,/結果の下書き/);const nextSeed=structuredClone(seed);nextSeed.weeks=[model.createWeek('2026-10-19')];const other=harness(storage,nextSeed);other.api.render();assert.doesNotMatch(other.node('#main').innerHTML,/結果の下書き/);assert.equal(Object.keys(h.api.get().blockDrafts).length,0);
});

test('same article notes synchronize across views with unique ARIA ids and do not enter shared POST',async()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed),net=mockApi(h,seed),key=h.api.keyFor([seed.weeks[0].id,seed.articles[0].id]);h.api.render();const first=h.reviewInput(key,'analysis','一つ目');h.reviewInput(key,'analysis','二つ目');assert.equal(first.value,'二つ目');const html=h.node('#main').innerHTML,ids=[...html.matchAll(/id="(article-review-[^\"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,2);assert.equal(new Set(ids).size,2);for(const id of ids)assert.ok(html.includes('aria-controls="'+id+'"'));assert.match(html,/colspan="17"/);assert.doesNotMatch(html.slice(html.indexOf('<tfoot>'),html.indexOf('</tfoot>')),/toggle-review|data-review-row/);
 await h.api.saveBlock(h.input('weeks.0.team.status','共有する報告'));assert.equal(net.posts.length,1);assert.doesNotMatch(JSON.stringify(net.posts),/二つ目|reviewField|analysis/);assert.equal(h.api.get().state.articles[0].metaCv,4);
});

test('invalid review storage and failed local saves keep recoverable input without exposing HTML',()=>{
 const seed=performanceSeed(),storage=new Map(),key=encodeURIComponent(JSON.stringify([seed.weeks[0].id,seed.articles[0].id]));storage.set('article-team-q3-2026-article-review-v1-'+key,'{bad json');const h=harness(storage,seed);h.api.render();assert.match(h.node('#main').innerHTML,/下書きを読み込めません/);h.ctx.localStorage.setItem=()=>{throw new Error('quota');};const payload='</textarea><img src=x onerror=alert(1)>';h.reviewInput(key,'next',payload);h.api.render();const html=h.node('#main').innerHTML;assert.match(html,/この端末に保存できません/);assert.match(html,/&lt;\/textarea&gt;&lt;img/);assert.doesNotMatch(html,/<img src=x/);assert.equal(h.api.get().state.articles[0].title,'検証記事');
});

test('review field input is bounded and unknown fields cannot write local or shared state',()=>{
 const seed=performanceSeed(),storage=new Map(),h=harness(storage,seed),key=h.api.keyFor([seed.weeks[0].id,seed.articles[0].id]);h.api.render();const field=h.reviewInput(key,'result','a'.repeat(7000));assert.equal(field.value.length,6000);const before=[...storage.values()][0];h.reviewInput(key,'__proto__','bad');assert.equal([...storage.values()][0],before);assert.equal(h.api.get().state.articles[0].metaCv,4);assert.equal(Object.keys(h.api.get().blockDrafts).length,0);
});

test('article rows open independently and clicks inside review inputs do not toggle the row',async()=>{
 const seed=performanceSeed();seed.articles.push({...seed.articles[0],id:'axad-second',title:'二つ目の記事'});const h=harness(new Map(),seed),first=h.api.keyFor([seed.weeks[0].id,seed.articles[0].id]),second=h.api.keyFor([seed.weeks[0].id,seed.articles[1].id]);h.api.render();const row={dataset:{reviewRow:first}};
 await h.node('#main').listeners.click({target:{closest:selector=>selector==='[data-review-row]'?row:null}});h.api.render();assert.ok(h.node('#main').innerHTML.includes('data-review-panel="'+first+'" >'));assert.ok(h.node('#main').innerHTML.includes('data-review-panel="'+second+'" hidden'));
 await h.node('#main').listeners.click({target:{closest:selector=>selector==='[data-review-row]'?row:selector.startsWith('button,a,input')?{}:null}});h.api.render();assert.ok(h.node('#main').innerHTML.includes('data-review-panel="'+first+'" >'));await h.click('toggle-review',{reviewKey:second});h.api.render();assert.ok(h.node('#main').innerHTML.includes('data-review-panel="'+second+'" >'));assert.ok(h.node('#main').innerHTML.includes('data-review-panel="'+first+'" >'));
});

test('authorless saving uses the API fallback and retries retain the original pending envelope',async()=>{
 const h=harness(),net=mockApi(h);h.set('editor','');h.api.render();assert.doesNotMatch(h.node('#main').innerHTML,/editor-name|editor-row|更新者/);await h.api.saveBlock(h.input('weeks.0.team.status','無名の保存'));assert.equal(net.posts[0].editor,'記事チーム');
 const retry=harness(),sent=[];retry.request(async(url,options)=>{if(!options)return {state:model.initialState(),revision:'r1'};sent.push(options.body);throw new Error('offline');});const key=retry.input('weeks.0.team.status','再送');await retry.api.saveBlock(key);retry.set('editor','');retry.request(async(url,options)=>{assert.ok(options);sent.push(options.body);return {state:JSON.parse(options.body).state,revision:'r2'};});await retry.api.saveBlock(key);assert.equal(sent[0],sent[1]);
});

test('article title links require exact metadata and safe URLs with a separate disclosure control',()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed),a=seed.articles[0],good={schemaVersion:1,articles:[{id:a.id,title:a.title,url:'https://example.com/ab/verified'}]};h.set('articleLinks',good);h.api.render();let html=h.node('#main').innerHTML;assert.match(html,/href="https:\/\/example.com\/ab\/verified" target="_blank" rel="noopener noreferrer"/);assert.match(html,/aria-label="検証記事の振り返りを開閉"/);assert.doesNotMatch(html,/usukura ·|10\/7リリース/);
 for(const value of [{...good,articles:[{...good.articles[0],title:'別記事'}]},{...good,articles:[{...good.articles[0],id:'別id'}]},...['javascript:alert(1)','//bad.invalid','https://user:secret@example.com'].map(url=>({...good,articles:[{...good.articles[0],url}]})),{...good,articles:[good.articles[0],good.articles[0]]}]){h.set('articleLinks',value);h.api.render();assert.doesNotMatch(h.node('#main').innerHTML,/class="article-title-link"/);}
});

test('clicking an article title link leaves reviews closed while the arrow opens the review',async()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed),key=h.api.keyFor([seed.weeks[0].id,seed.articles[0].id]);h.set('articleLinks',{schemaVersion:1,articles:[{id:seed.articles[0].id,title:seed.articles[0].title,url:'https://example.com/ab/verified'}]});h.api.render();const row={dataset:{reviewRow:key}};await h.node('#main').listeners.click({target:{closest:selector=>selector==='[data-review-row]'?row:selector.includes('button,a,input')?{}:null}});h.api.render();assert.ok(h.node('#main').innerHTML.includes('data-review-panel="'+key+'" hidden'));await h.click('toggle-review',{reviewKey:key});h.api.render();assert.ok(h.node('#main').innerHTML.includes('data-review-panel="'+key+'" >'));
});
