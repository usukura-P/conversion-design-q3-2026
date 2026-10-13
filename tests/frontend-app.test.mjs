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
 vm.runInContext(source+`\nstate=normalizeArticleReviews(seed);sharedState=normalizeArticleReviews(seed);activeWeek=seed.weeks[0].id;revision='r1';config={apiBase:'https://mock.invalid'};apiReady=true;editor='QA';globalThis.api={saveBlock,render,storeDraft,history,dispatchChart,report,initiativeDetails,articleSection,safeUrl,boot,legacyArticleReviewBackups,refreshShared,scanDrafts,downloadDraft,get:()=>({state,sharedState,revision,dirty,savingKey,syncing,blockDrafts,availableDrafts,axadData,importStatus,articleLinks}),path:inputBlockPath,valuePath:stableInputPath,keyFor,getKey:()=>OWN_DRAFT_KEY,export:()=>exportBlockDrafts(sharedState,blockDrafts)};globalThis.setValue=(k,v)=>eval(k+' = v');`,ctx);
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
test('personal sections start closed and each member field has one accessible label',()=>{
 const seed=model.initialState();seed.weeks.push(model.createWeek('2026-10-19'));const h=harness(new Map(),seed);h.api.render();const html=h.node('#main').innerHTML;
 for(const week of seed.weeks)assert.match(html,new RegExp('data-member-fold="'+week.id+'" >'));assert.match(html,/<section id="members" class="section"><details class="personal-fold"/);assert.match(html,/<summary><div class="section-title"><h2><span class="number">06<\/span>個人の進捗と振り返り<\/h2>/);
 const latest=html.slice(html.indexOf('<section id="members"'),html.indexOf('</section>',html.indexOf('<section id="members"')));assert.equal((latest.match(/class="card member-card"/g)||[]).length,4);assert.doesNotMatch(latest,/class="item-label"/);for(const label of ['取り組み・振り返り','FBからの学び・反映','次の行動'])assert.equal((latest.match(new RegExp('<span>'+label+'</span>','g'))||[]).length,4,label);for(const field of ['reflection','feedback','action'])assert.match(latest,new RegExp('data-path="weeks.1.members.aoki.'+field+'"'));assert.match(latest,/class="mini-chart"|class="chart mini-chart"/);
});

test('personal folds keep per-week current-tab state and unsaved text across saves and rerenders',async()=>{
 const seed=model.initialState();seed.weeks.push(model.createWeek('2026-10-19'));const h=harness(new Map(),seed),net=mockApi(h,seed);h.api.render();h.node('#main').listeners.toggle({target:{dataset:{memberFold:'2026-10-19'},open:true}});h.node('#main').listeners.toggle({target:{dataset:{memberFold:'2026-10-12'},open:true}});const key=h.input('weeks.1.members.aoki.reflection','保存する振り返り');h.input('weeks.1.members.aoki.action','未保存の次の行動');await h.api.saveBlock(key);h.api.render();let html=h.node('#main').innerHTML;for(const week of seed.weeks)assert.match(html,new RegExp('data-member-fold="'+week.id+'" open'));assert.match(html,/未保存の次の行動/);assert.equal(net.get().weeks[1].members.aoki.reflection,'保存する振り返り');assert.equal(net.get().weeks[1].members.aoki.action,'');
 h.node('#main').listeners.toggle({target:{dataset:{memberFold:'2026-10-12'},open:false}});h.api.get().state.weeks.push(model.createWeek('2026-10-26'));h.api.render();html=h.node('#main').innerHTML;assert.match(html,/data-member-fold="2026-10-12" >/);assert.match(html,/data-member-fold="2026-10-19" open/);assert.match(html,/data-member-fold="2026-10-26" >/);const reloaded=harness(new Map(),net.get());reloaded.api.render();assert.doesNotMatch(reloaded.node('#main').innerHTML,/data-member-fold="[^"]+" open/);
});

test('past weeks display saved measurements and never reuse current global initiative or article tables',()=>{
 const seed=performanceSeed();seed.weeks.push(model.createWeek('2026-10-19'));const h=harness(new Map(),seed);h.set('axadData',performanceData(seed));h.api.render();const html=h.node('#main').innerHTML,past=html.slice(html.indexOf('id="week-2026-10-12"'));assert.match(past,/記事の当時の詳細データは未保存/);assert.match(past,/保存時のCVR/);assert.match(past,/data-path="weeks.0.members.aoki.reflection"/);assert.doesNotMatch(past,/performance-table|data-action="add-article"|id="articles"|id="members"/);assert.equal((html.match(/id="articles"/g)||[]).length,1);assert.equal((html.match(/id="members"/g)||[]).length,1);
});

const reviewKey=(h,seed)=>h.api.keyFor([seed.weeks[0].id,seed.articles[0].id]);
const reviewBlock=(h,seed)=>h.api.keyFor(['weeks',{key:'id',id:seed.weeks[0].id},'articleReviews',{key:'id',id:seed.articles[0].id}]);
const reviewPrefix='article-team-q3-2026-article-review-v1-';
test('legacy three-field or unknown-rating reviews import explicitly, remain backed up and never auto POST',async()=>{
 for(const rating of [undefined,'invalid','◯','<img src=x onerror=alert(1)>']){
  const seed=performanceSeed(),key=encodeURIComponent(JSON.stringify([seed.weeks[0].id,seed.articles[0].id])),raw=JSON.stringify({schemaVersion:1,fields:{result:'昔の結果',analysis:'昔の考察',next:'昔のネクスト',...(rating===undefined?{}:{rating})}}),storage=new Map([[reviewPrefix+key,raw]]),h=harness(storage,seed),net=mockApi(h,seed);h.api.render();let html=h.node('#main').innerHTML;
  assert.match(html,/この端末の下書きを取り込む/);assert.doesNotMatch(html,/昔の結果|<img src=x/);assert.equal(net.posts.length,0);
  await h.click('import-review',{reviewKey:key,block:reviewBlock(h,seed)});h.api.render();html=h.node('#main').innerHTML;assert.match(html,/昔の結果/);assert.match(html,/昔の考察/);assert.match(html,/昔のネクスト/);assert.match(html,/<option value="" selected>未評価<\/option>/);assert.equal(net.posts.length,0);assert.equal(storage.get(reviewPrefix+key),raw);
  await h.api.saveBlock(reviewBlock(h,seed));assert.equal(net.posts.length,1);assert.equal(net.get().weeks[0].articleReviews[0].result,'昔の結果');assert.equal(h.api.legacyArticleReviewBackups()[reviewPrefix+key],raw);
 }
});
test('blank legacy reviews do not nag, and legacy fields never shadow newer shared content',()=>{
 const seed=performanceSeed(),key=encodeURIComponent(JSON.stringify([seed.weeks[0].id,seed.articles[0].id]));seed.weeks[0].articleReviews=[{id:seed.articles[0].id,rating:'good',result:'共有された結果',analysis:'',next:''}];
 for(const fields of [{rating:'',result:'',analysis:'',next:''},{rating:'good',result:'共有された結果',analysis:'',next:''}]){const h=harness(new Map([[reviewPrefix+key,JSON.stringify({schemaVersion:1,fields})]]),seed);h.api.render();assert.doesNotMatch(h.node('#main').innerHTML,/この端末の下書きを取り込む/);assert.match(h.node('#main').innerHTML,/共有された結果/);assert.match(h.node('#main').innerHTML,/<option value="good" selected>/);}
});
test('ratings and text synchronize both views and save one shared review without changing any metrics',async()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed),net=mockApi(h,seed),key=reviewKey(h,seed),block=reviewBlock(h,seed);h.api.render();const first=h.reviewInput(key,'rating',''),badges=[h.reviewBadge(key),h.reviewBadge(key)];
 for(const [value,label] of [['good','◯'],['caution','△'],['bad','×'],['','—']]){h.reviewInput(key,'rating',value);assert.equal(first.value,value);assert.equal(first.dataset.reviewRating,value);for(const badge of badges){assert.equal(badge.textContent,label);assert.equal(badge.dataset.reviewRating,value);}}
 h.reviewInput(key,'rating','good');const note=h.reviewInput(key,'analysis','最初');h.reviewInput(key,'analysis','二つ目');assert.equal(note.value,'二つ目');h.reviewInput(key,'result','確定結果');h.input('weeks.0.team.status','別欄の下書き');h.api.render();let html=h.node('#main').innerHTML;
 assert.equal((html.match(/data-review-rating-badge=/g)||[]).length,2);assert.equal((html.match(/data-review-rating="good" aria-label="評価：◯">◯<\/span>/g)||[]).length,2);assert.ok(html.indexOf('data-review-field="rating"')<html.indexOf('data-review-field="result"'));const ids=[...html.matchAll(/id="(article-review-[^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,2);for(const id of ids)assert.ok(html.includes('aria-controls="'+id+'"'));assert.match(html,/colspan="17"/);
 await h.api.saveBlock(block);assert.equal(net.posts.length,1);assert.equal(net.get().weeks[0].articleReviews[0].rating,'good');assert.equal(net.get().weeks[0].articleReviews[0].analysis,'二つ目');assert.equal(net.get().weeks[0].team.status,'');assert.equal(h.api.get().state.weeks[0].team.status,'別欄の下書き');assert.deepEqual(net.get().weeks[0].metrics,seed.weeks[0].metrics);assert.deepEqual(net.get().articles,seed.articles);assert.deepEqual(net.get().baseline,seed.baseline);assert.deepEqual(net.get().monthlyRevenue,seed.monthlyRevenue);
 const reloaded=harness(new Map(),net.get());reloaded.api.render();assert.match(reloaded.node('#main').innerHTML,/<option value="good" selected>/);assert.match(reloaded.node('#main').innerHTML,/確定結果/);assert.match(reloaded.node('#main').innerHTML,/共有済み/);
 const nextSeed=structuredClone(net.get());nextSeed.weeks.push(model.createWeek('2026-10-19'));const other=harness(new Map(),nextSeed);other.api.render();assert.doesNotMatch(other.api.articleSection(other.api.get().state.weeks[1]),/確定結果/);
});
test('invalid rating or unknown field cannot overwrite review text; bounded notes are escaped',()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed),key=reviewKey(h,seed);h.reviewInput(key,'result','既存結果');h.reviewInput(key,'rating','caution');const before=JSON.stringify(h.api.get().state);
 for(const invalid of ['other','◯','__proto__','<img src=x>']){assert.equal(h.reviewInput(key,'rating',invalid).value,'caution');assert.equal(JSON.stringify(h.api.get().state),before);}h.reviewInput(key,'__proto__','bad');assert.equal(JSON.stringify(h.api.get().state),before);assert.equal(h.reviewInput(key,'next','a'.repeat(7000)).value.length,6000);
 h.reviewInput(key,'analysis','</textarea><img src=x onerror=alert(1)>');h.api.render();assert.match(h.node('#main').innerHTML,/&lt;\/textarea&gt;&lt;img/);assert.doesNotMatch(h.node('#main').innerHTML,/<img src=x/);
});
test('unsaved shared reviews recover through explicit stored-draft action without publishing',async()=>{
 const seed=performanceSeed(),storage=new Map(),h=harness(storage,seed),key=reviewKey(h,seed);h.reviewInput(key,'result','下書き');await h.click('toggle-review',{reviewKey:key});await h.click('toggle-review',{reviewKey:key});h.api.render();assert.match(h.node('#main').innerHTML,/下書き/);assert.match(h.node('#main').innerHTML,/data-review-panel="[^"]+" hidden/);
 const other=harness(storage,seed),net=mockApi(other,seed);other.api.scanDrafts();other.api.render();assert.doesNotMatch(other.node('#main').innerHTML,/>下書き<\/textarea>/);await other.click('resume-draft',{draft:h.api.getKey()});other.api.render();assert.match(other.node('#main').innerHTML,/>下書き<\/textarea>/);assert.equal(net.posts.length,0);
});
test('malformed legacy storage remains exportable while storage failure retains visible recoverable review',()=>{
 const seed=performanceSeed(),storage=new Map(),h=harness(storage,seed),key=reviewKey(h,seed);storage.set(reviewPrefix+key,'{bad json');h.api.render();assert.match(h.node('#main').innerHTML,/下書きを読み込めません/);assert.equal(h.api.legacyArticleReviewBackups()[reviewPrefix+key],'{bad json');h.ctx.localStorage.setItem=()=>{throw new Error('quota');};h.reviewInput(key,'next','回収可能');h.api.render();assert.match(h.node('#main').innerHTML,/回収可能/);assert.match(h.node('#toast').textContent,/下書きをダウンロード/);
});
test('two clients merge different first-review fields and require explicit choice for the same field',async()=>{
 const seed=performanceSeed(),a=harness(new Map(),seed),b=harness(new Map(),seed);let shared=structuredClone(seed),revision='r1',posts=[];const request=async(u,o)=>{if(!o)return {state:structuredClone(shared),revision};const body=JSON.parse(o.body);validateState(body.state,shared.baseline);assert.equal(body.revision,revision);shared=body.state;posts.push(body);revision='r'+(posts.length+1);return {state:structuredClone(shared),revision};};a.request(request);b.request(request);
 const ka=reviewKey(a,seed),kb=reviewKey(b,seed),block=reviewBlock(a,seed);a.reviewInput(ka,'result','Aの結果');b.reviewInput(kb,'analysis','Bの考察');await a.api.saveBlock(block);await b.api.saveBlock(block);assert.equal(posts.length,2);assert.equal(shared.weeks[0].articleReviews[0].result,'Aの結果');assert.equal(shared.weeks[0].articleReviews[0].analysis,'Bの考察');
 const c=harness(new Map(),seed);c.request(request);c.reviewInput(reviewKey(c,seed),'result','Cの結果');await c.api.saveBlock(block);assert.equal(posts.length,2);assert.equal(c.api.get().blockDrafts[block].conflicts.length,1);assert.equal(c.api.export().mine.weeks[0].articleReviews[0].result,'Cの結果');await c.click('choose-conflict',{block,conflict:'0',choice:'mine'});await c.api.saveBlock(block);assert.equal(shared.weeks[0].articleReviews[0].result,'Cの結果');assert.equal(shared.weeks[0].articleReviews[0].analysis,'Bの考察');
});
test('failed shared-review POST retries exactly the pending envelope and freezes only its record',async()=>{
 const seed=performanceSeed(),h=harness(new Map(),seed),key=reviewKey(h,seed),block=reviewBlock(h,seed),sent=[];h.reviewInput(key,'rating','bad');h.reviewInput(key,'next','最初');h.request(async(u,o)=>{if(!o)return {state:structuredClone(seed),revision:'r1'};sent.push(o.body);throw new Error('offline');});await h.api.saveBlock(block);assert.ok(h.api.get().blockDrafts[block].pendingSave);h.reviewInput(key,'next','再送中の変更');assert.equal(h.api.get().state.weeks[0].articleReviews[0].next,'最初');h.input('weeks.0.team.status','別欄');
 h.request(async(u,o)=>{assert.ok(o);sent.push(o.body);return {state:JSON.parse(o.body).state,revision:'r2'};});await h.api.saveBlock(block);assert.equal(sent[0],sent[1]);assert.equal(h.api.get().state.weeks[0].team.status,'別欄');assert.equal(h.api.get().sharedState.weeks[0].team.status,'');
});
test('public legacy fallback normalizes empty reviews while API offline disables shared saving',async()=>{
 const seed=performanceSeed();delete seed.weeks[0].articleReviews;const h=harness(new Map(),seed);h.request(async u=>{if(u==='./config.json')return {apiBase:'https://mock.invalid'};if(u.endsWith('/api/state'))throw new Error('offline');if(u==='./data/state.json')return structuredClone(seed);throw new Error('missing');});await h.api.boot();assert.equal(h.api.get().state.weeks[0].articleReviews.length,0);h.api.render();assert.match(h.node('#main').innerHTML,/通信に失敗/);assert.match(h.node('#main').innerHTML,/この振り返りを保存<\/button>/);assert.doesNotMatch(h.node('#main').innerHTML,/共有保存は未対応/);
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

test('saving one article leaves other review drafts local and preserves remote records on refresh',async()=>{
 const seed=performanceSeed();seed.articles.push({...seed.articles[0],id:'axad-second',title:'二つ目の記事'});const h=harness(new Map(),seed),net=mockApi(h,seed),first=reviewKey(h,seed),second=h.api.keyFor([seed.weeks[0].id,seed.articles[1].id]);h.reviewInput(first,'result','共有する結果');h.reviewInput(second,'next','別記事の下書き');
 const fresh=structuredClone(seed);fresh.weeks[0].articleReviews=[{id:'deleted-article',rating:'caution',result:'以前の記事の記録',analysis:'',next:''}];fresh.weeks[0].team.status='同僚の報告';net.set(fresh);await h.api.saveBlock(reviewBlock(h,seed));assert.equal(net.get().weeks[0].articleReviews.length,2);assert.equal(net.get().weeks[0].articleReviews.find(r=>r.id==='deleted-article').result,'以前の記事の記録');assert.equal(net.get().weeks[0].articleReviews.some(r=>r.id==='axad-second'),false);assert.equal(h.api.get().state.weeks[0].articleReviews.find(r=>r.id==='axad-second').next,'別記事の下書き');assert.equal(h.api.get().state.weeks[0].team.status,'同僚の報告');
 const remote=structuredClone(net.get());remote.weeks[0].articleReviews.find(r=>r.id===seed.articles[0].id).rating='good';net.set(remote);await h.api.refreshShared();h.api.render();assert.equal(h.api.get().state.weeks[0].articleReviews.find(r=>r.id==='axad-second').next,'別記事の下書き');assert.match(h.node('#main').innerHTML,/<option value="good" selected>/);
});
test('review saves retain all existing snapshots including historical week reviews',async()=>{
 const seed=performanceSeed();seed.weeks.unshift(model.createWeek('2026-10-05'));seed.weeks[0].metrics.teamCvr=1.11;seed.weeks[0].articleReviews=[{id:seed.articles[0].id,rating:'bad',result:'以前の結果',analysis:'',next:''}];const h=harness(new Map(),seed),net=mockApi(h,seed),key=reviewKey(h,seed);h.reviewInput(key,'result','以前の結果を修正');await h.api.saveBlock(reviewBlock(h,seed));assert.deepEqual(net.get().weeks.map(w=>w.metrics),seed.weeks.map(w=>w.metrics));assert.equal(net.get().weeks[0].articleReviews[0].result,'以前の結果を修正');assert.equal(net.get().weeks[0].articleReviews[0].rating,'bad');assert.deepEqual(net.get().weeks[1],seed.weeks[1]);
});

test('new app and its required new model exports bypass old browser caches together',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),version=index.match(/app\.js\?v=([^"']+)/)[1];assert.equal(app.match(/from '\.\/model\.js\?v=([^']+)'/)[1],version);assert.match(index,new RegExp('style\\.css\\?v='+version));
});


test('article review field conflicts name the report and article and show rating symbols safely',()=>{
 const seed=performanceSeed();seed.articles[0].title='記事名 <img src=x>';const h=harness(new Map(),seed),path=['weeks',{key:'id',id:seed.weeks[0].id},'articleReviews',{key:'id',id:seed.articles[0].id}],block=h.api.keyFor(path),draft=model.makeBlockDraft(seed,path);draft.mine=model.emptyArticleReview(seed.articles[0].id);draft.conflicts=[{path:[...path,'rating'],mine:'good',theirs:'bad'},{path:[...path,'result'],mine:'<script>mine</script>',theirs:'共有結果'},{path:[...path,'analysis'],mine:'考察',theirs:'別の考察'},{path:[...path,'next'],mine:'次',theirs:'別の次'}];h.api.get().blockDrafts[block]=draft;h.api.render();let html=h.node('#main').innerHTML;
 for(const label of ['評価','結果','考察','ネクスト'])assert.ok(html.includes('報告週 2026-10-12 / 記事名 &lt;img src=x&gt; / '+label));assert.match(html,/<pre>◯<\/pre>/);assert.match(html,/<pre>×<\/pre>/);assert.match(html,/&lt;script&gt;mine/);assert.doesNotMatch(html,/weeks \/ 2026-10-12 \/ articleReviews|<img src=x>|<script>mine|<pre>good/);
 draft.conflicts=[{path:[...path,'rating'],mine:'',theirs:'caution'},{path,mine:undefined,theirs:model.emptyArticleReview(seed.articles[0].id),mineDelete:true}];h.api.render();html=h.node('#main').innerHTML;assert.match(html,/<pre>未評価<\/pre>/);assert.match(html,/<pre>△<\/pre>/);assert.match(html,/<pre>削除<\/pre>/);assert.ok(html.includes('weeks / 2026-10-12 / articleReviews / '+seed.articles[0].id));
});
