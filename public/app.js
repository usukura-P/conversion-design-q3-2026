import { PEOPLE, MONTHS, GOALS, STAGES, STATUS, QUALITATIVE, articleEvaluation, summarizeArticles, calculateMetrics, prepareSave, createWeek, nextMonday, previousWeek, dateOnly, mondayFor, mergeStates, applyConflictChoice, rebaseDraft, blockValue, setBlockValue, makeBlockDraft, mergeBlockDraft, overlayBlockDrafts, chooseBlockConflict, exportBlockDrafts } from './model.js';
import { performanceMetrics, sumRawMetrics, matchAxadArticle, trendPoints, jstObservationDate } from './axad-model.js';

const main=document.querySelector('#main');
let importStatus=null;
let axadData=null;
let state,sharedState,revision='',config={},activeWeek='',dirty=false,apiReady=false,offlineMessage='',editor='',savingKey='',syncing=false,blockDrafts={},availableDrafts=[];
const editing=true;
const DRAFT_KEY='article-team-q3-2026-blocks-v2-';
const TAB_ID=crypto.randomUUID(),OWN_DRAFT_KEY=DRAFT_KEY+TAB_ID;
const LEGACY_KEY='article-team-q3-2026-draft-v1';
const keyFor=path=>encodeURIComponent(JSON.stringify(path));
function stableInputPath(path){
 const parts=path.split('.');if(parts[0]==='weeks'){const week=state.weeks[Number(parts[1])],root=['weeks',{key:'id',id:week.id}];if(parts[2]==='qualitative')return [...root,'qualitative',{key:'id',id:week.qualitative[Number(parts[3])].id},...parts.slice(4)];return [...root,...parts.slice(2)];}const row=state[parts[0]][Number(parts[1])];return [parts[0],{key:parts[0]==='monthlyRevenue'?'month':'id',id:row.month||row.id},...parts.slice(2)];
}
function inputBlockPath(path){
 const parts=path.split('.');
 if(parts[0]==='weeks'){
  const week=state.weeks[Number(parts[1])],root=['weeks',{key:'id',id:week.id}];
  if(!sharedState?.weeks.some(w=>w.id===week.id))return root;
  if(parts[2]==='qualitative')return [...root,'qualitative',{key:'id',id:week.qualitative[Number(parts[3])].id}];
  return [...root,...parts.slice(2)];
 }
 const collection=parts[0],row=state[collection][Number(parts[1])];return [collection,{key:collection==='monthlyRevenue'?'month':'id',id:row.month||row.id}];
}
function blockActions(path,label='この欄を保存'){
 const key=keyFor(path),draft=blockDrafts[key],busy=savingKey===key;
 const error=draft?.error||'',pending=draft?.pendingSave;
 return `<div class="block-actions" data-block-actions="${e(key)}"><span class="block-status" role="status">${busy?'保存中…':draft?.conflicts?.length?'内容の選択が必要':error?e(error):draft?'この欄は未保存':'共有済み'}</span><button class="button small primary" data-action="save-block" data-block="${e(key)}" ${!draft||!apiReady||busy||syncing||draft?.conflicts?.length?'disabled':''}>${pending?'同じ内容で再送':e(label)}</button>${draft?`<button class="text-link" data-action="discard-block" data-block="${e(key)}">この欄の下書きを戻す</button>`:''}</div>`;
}
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cvr=value=>value==null?'—':Number(value).toFixed(2);
const shortDate=value=>value?`${Number(value.slice(5,7))}/${Number(value.slice(8,10))}`:'—';
const fullDate=value=>value?`${value.slice(0,4)}年${shortDate(value)}`:'未集計';
const money=value=>value==null?'未集計':(value/100000000).toFixed(2);
const person=id=>PEOPLE.find(p=>p.id===id)||{name:id};
const statusLabel=id=>STATUS.find(s=>s[0]===id)?.[1]||'未着手';
const stageLabel=id=>STAGES.find(s=>s[0]===id)?.[1]||'立案';
function formatTime(value){if(!value)return 'まだ保存されていません';return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
function display(value){return value?`<div class="display-value">${e(value)}</div>`:'<div class="display-value empty">未記入</div>';}
function input(path,label,value,{type='text',placeholder='',textarea=false,options=null,wide=false}={}){
 const attrs=`data-block="${e(keyFor(inputBlockPath(path)))}" data-path="${e(path)}" data-value-path="${e(keyFor(stableInputPath(path)))}" data-type="${type==='number'?'number':type==='date'?'date':'text'}"`;
 const control=options?`<select ${attrs}>${options.map(([v,l])=>`<option value="${e(v)}" ${value===v?'selected':''}>${e(l)}</option>`).join('')}</select>`:textarea?`<textarea ${attrs} placeholder="${e(placeholder)}" rows="3" maxlength="6000">${e(value)}</textarea>`:`<input ${attrs} type="${type}" value="${e(value)}" placeholder="${e(placeholder)}" ${type==='number'?'min="0" step="any"':''} ${type==='text'?'maxlength="500"':''}>`;
 return `<label class="form-field ${wide?'wide':''}"><span>${e(label)}</span>${control}</label>`;
}
function editable(path,label,value,placeholder=''){const scope=inputBlockPath(path);return `<div class="inline-field">${input(path,label,value,{textarea:true,placeholder})}${blockActions(scope)}</div>`;}
const sectionTitle=(n,title,note='',actions='')=>`<div class="section-title"><h2><span class="number">${n}</span>${title}</h2>${actions?`<div class="section-actions">${note?`<span class="subtle">${note}</span>`:''}${actions}</div>`:`<p>${note}</p>`}</div>`;
function revenueChart(revenues=sharedState.monthlyRevenue){
 const rows=[{label:'9月',actual:state.baseline.septemberRevenue,goal:null},...MONTHS.map(m=>({...m,actual:revenues.find(r=>r.month===m.month)?.actual}))];
 const max=Math.max(...rows.map(r=>Math.max(r.goal||0,r.actual||0)),1000000000);const W=450,H=222,left=36,top=17,bottom=180,plot=160;const y=v=>bottom-v/max*plot;
 let s=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="9月実績と10月・11月・12月の売上目標・実績。未集計は描画しません。">`;
 for(let i=0;i<=4;i++){const val=max*i/4;s+=`<line class="axis" x1="${left}" x2="438" y1="${y(val)}" y2="${y(val)}"/><text x="27" y="${y(val)+3}" text-anchor="end">${(val/100000000).toFixed(0)}</text>`;}
 s+='<text x="10" y="10">億円</text>';
 rows.forEach((r,i)=>{const x=84+i*102;if(r.goal!=null)s+=`<rect x="${x-20}" y="${y(r.goal)}" width="36" height="${bottom-y(r.goal)}" fill="#e2e9f5" rx="4"/><text x="${x}" y="${y(r.goal)-8}" text-anchor="middle">目標 ${money(r.goal)}</text>`;if(r.actual!=null)s+=`<rect x="${x-12}" y="${y(r.actual)}" width="25" height="${Math.max(1,bottom-y(r.actual))}" fill="${i===0?'#aebbd1':'#3867ed'}" rx="4"/><text class="value" x="${x}" y="${y(r.actual)-8}" text-anchor="middle">${money(r.actual)}</text>`;else s+=`<text x="${x}" y="${bottom-12}" text-anchor="middle">未集計</text>`;s+=`<text x="${x}" y="${bottom+23}" text-anchor="middle">${r.label}</text>`;});return s+'</svg>';
}
function trendChart({member=null,mini=false}={}){
 const points=trendPoints(axadData,sharedState.weeks,member);
 const W=mini?450:510,H=mini?120:240,left=mini?28:35,right=mini?12:17,top=mini?25:35,bottom=mini?88:185;
 const max=Math.max(4,...points.map(p=>p.value??0))*1.1;
 const y=v=>bottom-v/max*(bottom-top),x=i=>left+i*(W-left-right)/Math.max(points.length-1,1);
 let s=`<svg class="${mini?'mini-chart':'chart'}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Meta実質CVRの記事単純平均の累計推移。9月参考累計と10/1開始の3Q累計を分けて表示。">`;
 [0,1,2,3,4].filter(v=>v<=max).forEach(v=>{s+=`<line class="axis" x1="${left}" x2="${W-right}" y1="${y(v)}" y2="${y(v)}"/>${mini&&v!==0&&v!==3?'':`<text x="${left-8}" y="${y(v)+3}" text-anchor="end">${v}${mini?'':'%'}</text>`}`;});
 s+=`<line class="target" x1="${left}" x2="${W-right}" y1="${y(3)}" y2="${y(3)}"/><text x="${W-right}" y="${y(3)-6}" text-anchor="end" style="fill:#159877">目標 3.0%</text>`;
 const firstQuarter=points.findIndex(p=>p.segment==='quarter');
 if(firstQuarter>0){const split=(x(firstQuarter-1)+x(firstQuarter))/2;s+=`<line class="period-reset" x1="${split}" x2="${split}" y1="${top}" y2="${bottom}"/><text x="${split}" y="${mini?14:19}" text-anchor="middle" class="reset-label">3Q開始</text>`;}
 points.forEach((p,i)=>{
  const color=p.segment==='september'?'#aab9d0':'#3867ed';
  const tooltip=`${p.segment==='september'?'9月参考累計':'3Q累計'} ${cvr(p.value)}%\n対象リリース ${p.releaseStart}〜${p.releaseEnd}\n観測日 ${p.observedThrough}（各記事リリース日から）\n測定記事 ${p.eligibleArticles??'—'}件${p.source==='snapshot'?' · 報告保存時点':' · AXAD参考集計'}`;
  if(p.value!=null){if(i>0&&points[i-1].value!=null&&points[i-1].segment===p.segment)s+=`<line data-segment="${p.segment}" x1="${x(i-1)}" y1="${y(points[i-1].value)}" x2="${x(i)}" y2="${y(p.value)}" stroke="${color}" stroke-width="2.2"/>`;const dot=`<title>${e(tooltip)}</title><circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="${color}" stroke="white" stroke-width="2"/><text class="value" x="${x(i)}" y="${y(p.value)-11}" text-anchor="middle">${cvr(p.value)}</text>`;s+=p.week?`<a class="chart-link" href="#week-${p.week}" data-jump-week="${p.week}">${dot}</a>`:`<g tabindex="0">${dot}</g>`;}
  else s+=`<g tabindex="0"><title>${e(tooltip)}</title><circle cx="${x(i)}" cy="${bottom}" r="3" fill="#fff" stroke="#d4ddeb"/><text x="${x(i)}" y="${bottom-9}" text-anchor="middle">—</text></g>`;
  s+=`<text x="${x(i)}" y="${bottom+20}" text-anchor="middle">${shortDate(p.observedThrough)}</text>`;
 });
 if(!points.length)s+=`<text x="${W/2}" y="${mini?48:112}" text-anchor="middle" style="fill:#9aa8bc;font-size:${mini?8:10}px">AXAD週別詳細未取得 · 保存済みの集計を待っています</text>`;
 return s+'</svg>';
}
function initiativeMetricsKnown(week){return Boolean(week.metrics.asOf&&(week.id!==sharedState.weeks.map(w=>w.id).sort().at(-1)||sharedState.initiatives.length||week.metrics.dispatched>0||Object.values(week.metrics.people).some(p=>p.proposals>0)));}
function dispatchChart(){
 const weeks=[...sharedState.weeks].sort((a,b)=>a.id.localeCompare(b.id));const W=940,H=158,left=34,right=17,top=20,bottom=117;
 const max=Math.max(10,...weeks.filter(w=>initiativeMetricsKnown(w)).map(w=>w.metrics.dispatched+1));const y=v=>bottom-v/max*(bottom-top),x=i=>left+i*(W-left-right)/Math.max(weeks.length-1,1);
 let svg=`<svg class="chart dispatch-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="3Q累計配信件数の週次推移。保存済みの週のみ描画し、9件の目標線を表示。">`;
 [0,3,6,9].forEach(v=>{svg+=`<line class="axis" x1="${left}" x2="${W-right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left-9}" y="${y(v)+3}" text-anchor="end">${v}件</text>`;});
 svg+=`<line class="target" x1="${left}" x2="${W-right}" y1="${y(9)}" y2="${y(9)}"/><text x="${W-right}" y="${y(9)-6}" text-anchor="end" style="fill:#159877">目標9件</text>`;
 let last=null;weeks.forEach((w,i)=>{if(initiativeMetricsKnown(w)){if(last)svg+=`<path d="M ${last.x} ${y(last.count)} H ${x(i)} V ${y(w.metrics.dispatched)}" fill="none" stroke="#3867ed" stroke-width="2.2"/>`;svg+=`<a class="chart-link" href="#week-${w.id}" data-jump-week="${w.id}"><circle cx="${x(i)}" cy="${y(w.metrics.dispatched)}" r="4" fill="#3867ed" stroke="white" stroke-width="2"/><text class="value" x="${x(i)}" y="${y(w.metrics.dispatched)-10}" text-anchor="middle">${w.metrics.dispatched}</text></a>`;last={x:x(i),count:w.metrics.dispatched};}svg+=`<text x="${x(i)}" y="${bottom+22}" text-anchor="middle">${shortDate(w.id)}報告</text>`;});
 if(!last)svg+=`<text x="${W/2}" y="${y(4.8)}" text-anchor="middle" style="font-size:11px;fill:#92a1b8">週次を保存すると、配信までの進捗が蓄積されます</text>`;
 return `<div class="card chart-card" style="margin-top:18px"><div class="chart-head"><div><h3>配信進捗の変遷</h3><p>記事部立案施策 · 3Q累計</p></div><div class="legend"><span><i></i>配信済み</span><span><i class="green"></i>目標9件</span></div></div>${svg}</svg><div class="chart-note"><span>配信日が10/1〜12/31の施策を集計</span><span>各週の保存時点の実績を表示</span></div></div>`;
}
function currentWeek(){return state.weeks.find(w=>w.id===activeWeek)||state.weeks[0];}
function overview(week){
 const isLatest=week.id===state.weeks.map(w=>w.id).sort().at(-1);const revenues=isLatest?sharedState.monthlyRevenue:(week.metrics.monthlyRevenue||MONTHS.map(m=>({month:m.month,actual:null,asOf:null})));
 const m=week.metrics;const month=MONTHS.find(x=>week.id.startsWith(x.month))||MONTHS[0];const rev=revenues.find(r=>r.month===month.month);const sept=state.baseline.septemberCvr;const delta=m.teamCvr!=null&&sept!=null?m.teamCvr-sept:null;
 const initCount=state.initiatives.length;const prev=summarizeArticles(state.articles.filter(a=>a.releaseDate>=week.releaseStart&&a.releaseDate<=week.releaseEnd));
 return `<section id="overview" class="section">${sectionTitle('01','3Qの全体進捗','目標・現在地・9月からの変化')}<div class="kpi-grid">
 <div class="card kpi-card"><div class="card-label">${month.label}売上<span class="label-tag">KGI</span></div><div class="kpi-number">${rev?.actual==null?'<span class="missing">未集計</span>':money(rev.actual)+'<small>億円</small>'}</div><div class="kpi-detail">目標 <strong>${money(month.goal)}億円</strong>${rev?.asOf?` · ${shortDate(rev.asOf)}時点`:''}</div><div class="kpi-foot"><span>9月実績 ${money(state.baseline.septemberRevenue)}億円</span><span class="pill ${rev?.actual!=null?'blue':'gray'}">${rev?.actual==null?'AXAD更新待ち':`達成率 ${(rev.actual/month.goal*100).toFixed(1)}%`}</span></div></div>
 <div class="card kpi-card"><div class="card-label">3Q累計 Meta実質CVR<span class="label-tag">${importStatus&&!importStatus.populationComplete?'登録分のみ':'KPI 01'}</span></div><div class="kpi-number">${m.teamCvr==null?'<span class="missing">未集計</span>':cvr(m.teamCvr)+'<small>%</small>'}</div><div class="kpi-detail">目標 <strong>3.0%以上</strong> · 記事ごとの単純平均</div><div class="kpi-foot"><span>${delta==null?`9月 ${cvr(sept)}%`:`9月比 ${delta>=0?'+':''}${delta.toFixed(2)}pt`}</span><span class="pill ${m.teamCvr>=3&&m.teamCvr!=null?'green':'gray'}">${m.eligibleArticles}記事測定可／${m.unmeasurableArticles}記事未測定</span></div></div>
 <div class="card kpi-card"><div class="card-label">記事部立案施策の配信<span class="label-tag">KPI 02</span></div><div class="kpi-number">${initCount?m.dispatched:'<span class="missing">未登録</span>'}<small>／ 9件</small></div><div class="kpi-detail">3Q累計 · <strong>配信日</strong>が記録された施策</div><div class="progress-segments" aria-label="配信${m.dispatched}件／9件">${Array.from({length:9},(_,i)=>`<i class="${i<m.dispatched?'filled':''}"></i>`).join('')}</div><div class="quarter-caption">立案 → 優先度会議 → 制作 → 配信 → 振り返り</div></div></div>
 <div class="chart-grid"><div class="card chart-card"><div class="chart-head"><div><h3>売上の変遷</h3><p>9月を起点に、月ごとの目標と実績を比較</p></div><div class="legend"><span><i></i>実績</span><span><i class="goal"></i>目標</span></div></div>${revenueChart(revenues)}<div class="chart-note"><span>3Q売上目標合計 <strong>24.00億円</strong></span><span>AXADから週次更新 · 月途中は集計日を併記</span></div></div>
 <div class="card chart-card"><div class="chart-head"><div><h3>制作成果の変遷</h3><p>リリース記事を週ごとに累積 · 平均Meta実質CVR</p></div><div class="legend"><span><i></i>実績</span><span><i class="green"></i>目標</span></div></div>${trendChart()}<div class="chart-note"><span>9月参考累計 <strong>9/1開始</strong> → 3Q累計 <strong>10/1開始</strong></span><span>登録記事の単純平均 · 目標3.0%</span></div><div class="as-of">各週末までのリリース記事を累積。原数の観測は各リリース日〜当該週末（最新は取得日）。9月から3Qで対象を切り替えます。保存済み報告の集計値は当時の値を保持します。</div></div></div>
 ${dispatchChart()}${!isLatest?'<p class="subtle" style="margin-top:12px">売上はこの週の保存時点のAXAD実績です。最新の実績はAXADから週次更新します。</p>':''}${baselineSection()}</section>`;
}
function baselineSection(){return `<details class="card baseline-card"><summary>比較の基準と集計ルール <span style="margin-left:12px;color:#99a6b8">9月 ${cvr(state.baseline.septemberCvr)}% · 2Q参考 ${cvr(state.baseline.q2Cvr)}%</span></summary><div class="baseline-content"><p>Metaのみ・消化額の足切りなし。記事名に「貸し」「修正」を含む記事は除外。クリック0・Meta未配信は平均から除外し、0CVは測定可能として含めます。</p><p>実質CVR = Meta CV ÷ Metaクリック × 100。チーム・個人とも記事ごとの単純平均。3Qの対象は10/1〜12/31リリース記事です。</p><p>9月・2Qの数値は同じ新条件で再集計しています。臼倉の目標・進捗はチーム平均を使用します。</p><p>9月の月次参考値は初回19記事の集計。週別グラフは確認できた9/25の3記事を補完した22記事の集計です。母集団が異なるため、9月末のグラフと月次参考値は一致しません。</p><table><thead><tr><th>対象</th><th>9月</th><th>2Q参考</th></tr></thead><tbody><tr><td>チーム</td><td>${cvr(state.baseline.septemberCvr)}%</td><td>${cvr(state.baseline.q2Cvr)}%</td></tr>${state.baseline.people.map(p=>`<tr><td>${e(p.name)}（本人担当）</td><td>${p.septemberCvr==null?'該当記事なし':cvr(p.septemberCvr)+'%'}</td><td>${cvr(p.q2Cvr)}%</td></tr>`).join('')}</tbody></table>${(state.baseline.notes||[]).map(n=>`<p>${e(n)}</p>`).join('')}<div style="margin-top:12px">${(state.baseline.sources||[]).map(s=>`<p>${safeUrl(s.url)?`<a href="${e(s.url)}" target="_blank" rel="noopener">${e(s.label)}</a>`:e(s.label)}${s.asOf?` · ${e(s.asOf)}`:''}</p>`).join('')}</div></div></details>`;}
function report(week,wi){return `<section id="report" class="section">${sectionTitle('02','今週のチーム報告','火曜：報告2分 ＋ 質疑3分')}<div class="card report-card"><div class="report-main"><div class="eyebrow">THIS WEEK’S SUMMARY</div>${editable(`weeks.${wi}.team.status`,'今の状態・結論',week.team.status,'目標に対して今どんな状態か。結論を1〜2文で。')}<div class="report-sub"><div><div class="item-label">前週からの変化・その理由</div>${editable(`weeks.${wi}.team.change`,'前週からの変化・その理由',week.team.change,'数値・施策がどう変わったか、その理由。')}</div><div><div class="item-label">記事が課題になっている案件</div>${editable(`weeks.${wi}.team.issues`,'案件課題・対応',week.team.issues,'案件名、売上に対する記事の課題、対応方針。')}</div></div></div><div class="report-aside"><div class="item-label"><span class="dot"></span>今週の優先事項</div>${editable(`weeks.${wi}.team.priorities`,'今週の優先事項',week.team.priorities,'最大3件。担当・期限・完了条件を記入。')}<div class="consult"><div class="item-label">PC局への相談・判断依頼</div>${editable(`weeks.${wi}.team.requests`,'相談・判断依頼',week.team.requests,'決めてほしいこと／協力してほしいこと。')}</div></div></div></section>`;}
function initiativeSection(){return `<section id="initiatives" class="section">${sectionTitle('04','施策の進行','3Q立案3件／人 → チーム配信9件','<button class="button small edit-only" data-action="add-initiative">＋ 施策を追加</button>')}<div class="pipeline">${STAGES.map(([id,label])=>`<div class="pipeline-step"><strong>${state.initiatives.length?state.initiatives.filter(x=>x.stage===id).length:'—'}</strong><span>${label}</span></div>`).join('')}</div><div class="card table-card">${state.initiatives.length?state.initiatives.map((i,idx)=>initiativeDetails(i,idx)).join(''):'<div class="empty-state"><strong>施策を登録すると、進行と根拠がここに集まります。</strong><p>立案の背景、売れている事実、制作の工夫、FBと学びを一つの施策に記録。</p></div>'}<div class="table-note">立案件数は「優先度会議に上がった日」、配信件数は「配信日」で3Q累計を集計します。進行段階の変更だけでは加算されません。</div></div></section>`;}
function initiativeDetails(i,idx){const fields=[['evidence','売れている根拠'],['background','施策立案の背景'],['craft','制作時の工夫'],['feedback','FB・修正不要の判定'],['learning','学び・ナレッジ'],['next','次の行動']];return `<details class="item-details" ${!i.title?'open':''}><summary><span class="inline-owner"><span class="avatar">${e(person(i.owner).name.slice(0,1))}</span>${e(person(i.owner).name)}</span><strong>${e(i.title)||'新しい施策'}</strong><span class="pill ${['dispatched','reviewed'].includes(i.stage)?'green':'blue'}">${stageLabel(i.stage)}</span><span class="summary-meta">${i.deadline?'期限 '+shortDate(i.deadline):'期限未記入'}</span></summary><div class="detail-content"><div class="read-only"><div class="detail-text-grid">${fields.map(([key,label])=>`<div><h5>${label}</h5><p>${e(i[key])||'未記入'}</p></div>`).join('')}</div><p class="subtle">優先度会議 ${shortDate(i.meetingDate)} · 配信 ${shortDate(i.dispatchDate)} · 期限 ${shortDate(i.deadline)} ${safeUrl(i.url)?`· <a href="${e(i.url)}" target="_blank" rel="noopener">関連リンク ↗</a>`:''}</p></div><div class="edit-only fields-grid edit-grid">${input(`initiatives.${idx}.title`,'施策名',i.title,{wide:true})}${input(`initiatives.${idx}.owner`,'担当',i.owner,{options:PEOPLE.map(p=>[p.id,p.name])})}${input(`initiatives.${idx}.stage`,'進行段階',i.stage,{options:STAGES})}${input(`initiatives.${idx}.deadline`,'期限',i.deadline,{type:'date'})}${input(`initiatives.${idx}.meetingDate`,'優先度会議に上がった日',i.meetingDate,{type:'date'})}${input(`initiatives.${idx}.dispatchDate`,'配信日',i.dispatchDate,{type:'date'})}${input(`initiatives.${idx}.url`,'関連リンク',i.url,{placeholder:'https://…'})}${fields.map(([key,label])=>input(`initiatives.${idx}.${key}`,label,i[key],{textarea:true})).join('')}</div><div class="detail-actions edit-only edit-flex">${blockActions(inputBlockPath(`initiatives.${idx}.title`),'この施策を保存')}<button class="button small danger" data-action="delete-initiative" data-index="${idx}">この施策を削除</button></div></div></details>`;}
const PERFORMANCE_COLUMNS=[['spend','消化金額','money'],['mcv','MCV','count'],['cv','CV','count'],['revenue','売上','money'],['profit','利益','money'],['roas','ROAS','percent'],['cpa','CPA','money'],['cpm','CPM','money'],['impressions','Imp','count'],['clicks','Clicks','count'],['ctr','CTR','percent'],['cpc','CPC','money'],['mcvr','MCVR','percent'],['mcpa','MCPA','money'],['cvr','CVR','percent'],['realCvr','実質CVR','percent']];
function articleMatch(a,week=currentWeek()){
 const latest=state.weeks.map(w=>w.id).sort().at(-1);
 const date=week.id===latest?null:(jstObservationDate(week.metrics.asOf)||'unrecorded');
 return matchAxadArticle(a,axadData,date);
}
function performanceCells(metrics){
 return PERFORMANCE_COLUMNS.map(([key,label,type])=>{
  const value=metrics[key],negative=key==='profit'&&value!=null&&value<0;
  const formatted=value==null?'—':type==='money'?'¥'+Math.round(value).toLocaleString('ja-JP'):type==='percent'?value.toFixed(2)+'%':value.toLocaleString('ja-JP');
  const badge=type==='percent'&&value!=null?`pill ${key==='realCvr'?(value>=3?'green':'blue'):key==='roas'?(value>=100?'green':'amber'):'metric-neutral'}`:'';
  return `<td class="metric-cell ${negative?'negative':''}"><span class="${badge}">${formatted}</span></td>`;
 }).join('');
}
function performanceTable(rows,week,label){
 const evaluated=rows.map(({a,idx})=>({a,idx,match:articleMatch(a,week)}));
 if(!evaluated.length)return '<div class="empty-state"><strong>対象期間の記事はまだ登録されていません。</strong><p>AXAD取得後に記事別の数値を表示します。</p></div>';
 const totals=performanceMetrics(sumRawMetrics(evaluated.map(r=>r.match.raw)));
 return `<div class="table-wrap performance-wrap" tabindex="0" aria-label="${e(label)}。横にスクロールして全指標を確認できます。"><table class="data-table performance-table"><thead><tr><th>記事名</th>${PERFORMANCE_COLUMNS.map(([,name])=>`<th>${name}</th>`).join('')}</tr></thead><tbody>${evaluated.map(({a,idx,match})=>`<tr><td class="title-cell sticky-title"><strong>${e(a.title)||'記事名未記入'}</strong><small>${e(person(a.owner).name)} · ${shortDate(a.releaseDate)}リリース</small><small>${match.status==='matched'?`観測 ${shortDate(a.releaseDate)}〜${shortDate(match.source.observedThrough)}`:`<span class="pill gray">${match.status==='historical_missing'?'当時詳細未取得':match.status==='unmatched'?'未照合':'AXAD詳細未取得'}</span>`}</small></td>${performanceCells(performanceMetrics(match.raw))}</tr>`).join('')}</tbody><tfoot><tr><td class="sticky-title"><strong>合計</strong><small>原数合算から比率を再算出</small></td>${performanceCells(totals)}</tr></tfoot></table></div>`;
}
function articleSection(week){
 const all=state.articles.map((a,idx)=>({a,idx})),cohort=all.filter(({a})=>a.releaseDate>=week.releaseStart&&a.releaseDate<=week.releaseEnd),summary=summarizeArticles(cohort.map(x=>x.a));
 return `<section id="articles" class="section">${sectionTitle('05','前週リリース記事の振り返り',`${shortDate(week.releaseStart)}（月）〜${shortDate(week.releaseEnd)}（日）`,'<button class="button small edit-only" data-action="add-article">＋ 記事を追加</button>')}<div class="card table-card"><div class="article-summary"><div><strong>${cvr(week.metrics.previousWeekCvr)}</strong>% <span style="font-size:9px">保存時の記事単純平均CVR</span></div><span>測定可 ${summary.eligible}件</span><span>未測定 ${summary.unmeasurable}件</span><span>除外 ${summary.excluded}件</span><span class="rules">Metaのみ／消化額の足切りなし<br>「貸し」「修正」を含む記事は除外</span></div>${!axadData?'<div class="table-note">AXAD詳細未取得。確認できる原数がないため、数値は表示していません。</div>':''}${performanceTable(cohort,week,'前週リリース記事のAXAD実績')}${cohort.map(({a,idx})=>articleDetails(a,idx,week)).join('')}<details class="item-details"><summary>3Qの全記事を確認する <span class="summary-meta">${all.length}件登録</span></summary>${performanceTable(all,week,'3Q全記事のAXAD実績')}${all.map(({a,idx})=>articleDetails(a,idx,week)).join('')}</details><div class="table-note">AXAD記事別の原数・比率は読取専用。表の合計は原数を合算して比率を再計算し、上のKPI（記事ごとの単純平均）とは計算が異なります。CVR＝CV÷MCV、実質CVR＝CV÷Clicks。クリック0・未配信はKPI平均から除外し、0CV・クリックありは0%として含めます。記事名・担当・リリース日・観測日・CV/Clicksが取得データと一致しない記事は未照合、過去週の当時原数がない場合は当時詳細未取得として表示します。CPAは既知の消化金額・0CVの場合、AXADと同じ¥0表示です。</div></div></section>`;
}
function articleDetails(a,idx,week=currentWeek()){
 const match=articleMatch(a,week);
 return `<details class="item-details" ${!a.title?'open':''}><summary>${e(a.title)||'新しい記事'}<span class="summary-meta">担当・日付・関連施策を編集</span></summary><div class="detail-content"><p class="card-message">AXAD数値は週次取得時に更新します。観測期間 ${match.status==='matched'?shortDate(a.releaseDate)+'〜'+shortDate(match.source.observedThrough):match.status==='historical_missing'?'当時詳細未取得':match.status==='unmatched'?'取得データと未照合':'AXAD詳細未取得'}</p><div class="edit-only fields-grid edit-grid">${input(`articles.${idx}.title`,'記事名',a.title,{wide:true})}${input(`articles.${idx}.owner`,'担当',a.owner,{options:PEOPLE.map(p=>[p.id,p.name])})}${input(`articles.${idx}.releaseDate`,'リリース日',a.releaseDate,{type:'date'})}${input(`articles.${idx}.initiativeId`,'関連施策',a.initiativeId,{options:[['','未選択'],...(a.initiativeId&&!state.initiatives.some(i=>i.id===a.initiativeId)?[[a.initiativeId,'削除済みの施策（選び直してください）']]:[]),...state.initiatives.map(i=>[i.id,i.title||'施策名未記入'])]})}</div><div class="detail-actions edit-only edit-flex">${blockActions(inputBlockPath(`articles.${idx}.title`),'この記事を保存')}<button class="button small danger" data-action="delete-article" data-index="${idx}">この記事を削除</button></div></div></details>`;
}
function memberSection(week,wi){return `<section id="members" class="section">${sectionTitle('06','個人の進捗と振り返り','全員のCVR達成と、立案・制作力の向上')}<div class="member-grid">${PEOPLE.map(p=>{const m=week.metrics.people[p.id],member=week.members[p.id];const baseline=p.id==='usukura'?state.baseline.septemberCvr:state.baseline.people.find(b=>b.id===p.id)?.septemberCvr;return `<article class="card member-card"><div class="member-header"><span class="avatar">${p.name.slice(0,1)}</span><div><h3>${p.name}</h3><p>${p.role}</p></div><span class="pill ${m.cvr!=null&&m.cvr>=3?'green':'gray'}">${m.cvr==null?'実績未集計':m.cvr>=3?'CVR目標達成':'CVR目標まで '+(3-m.cvr).toFixed(2)+'pt'}</span></div><div class="member-metrics"><div class="member-metric"><span>${p.id==='usukura'?'チーム平均':'平均'}Meta実質CVR</span><strong>${cvr(m.cvr)}<small> %</small></strong><p>目標3.0%以上 · 9月 ${cvr(baseline)}%</p></div><div class="member-metric"><span>${p.id==='usukura'?'記事部立案施策の配信':'優先度会議に上がった施策'}</span><strong>${!initiativeMetricsKnown(week)?'<span class="unrecorded">未登録</span>':p.id==='usukura'?week.metrics.dispatched:m.proposals}<small> ／ ${p.id==='usukura'?9:3}件</small></strong><p>3Q累計 · ${p.id==='usukura'?'配信日':'会議日'}で判定</p>${p.id!=='usukura'?`<div class="progress-segments" aria-label="立案${m.proposals}件／3件">${Array.from({length:3},(_,i)=>`<i class="${i<m.proposals?'filled':''}"></i>`).join('')}</div>`:''}</div></div>${trendChart({member:p.id,mini:true})}<div class="member-focus"><h4>${p.focus}</h4><p>${p.detail}${p.evaluation?`<br>評価軸：${p.evaluation}`:''}</p></div><div class="member-fields"><div><div class="item-label">今週の取り組み・振り返り</div>${editable(`weeks.${wi}.members.${p.id}.reflection`,'取り組み・振り返り',member.reflection,'取り組みの変化・得られた成果。施策の詳細は施策欄に記入。')}</div><div><div class="item-label">FBからの学び・反映</div>${editable(`weeks.${wi}.members.${p.id}.feedback`,'FBからの学び・反映',member.feedback,'何を指摘され、なぜそうなったか。今回どう反映したか。')}</div><div><div class="item-label">次の行動</div>${editable(`weeks.${wi}.members.${p.id}.action`,'次の行動',member.action,'不足を埋める具体的な行動・期限。')}</div></div><details class="member-goals"><summary>定性目標・行動計画を見る</summary>${p.id==='usukura'?`<p>記事が確実に回る／売れている事実に基づいた方向性が立つ／制作の質が上がる。評価軸はメンバー全員定量目標達成。</p><p>前提：${p.context}</p>`:'<p>状態目標：施策立案・完成物に対するフィードバックが、FB担当者目線で不要だと判定される状態。</p><p>① FBから「なぜ」を深掘りし、自身に不足している点を特定する。<br>② 課題を払拭する行動を決め、実行する。<br>③ 実際の施策立案・制作に落とし込みFBを受ける。<br>日報・1on1の振り返りを通してこのサイクルを回す。</p>'}<p>目標設定時の2Q参考値：${p.q2.toFixed(2)}%（旧条件）。グラフは新条件で再集計した9月を使用。</p></details></article>`;}).join('')}</div></section>`;}
function history(){return `<section id="history" class="section">${sectionTitle('07','週次の記録','今週・前週を表示。それ以前は折りたたむ。')}<div class="card history-card">${[...sharedState.weeks].sort((a,b)=>b.id.localeCompare(a.id)).map((w,i)=>`<details class="week-history" id="week-${w.id}" ${i<2?'open':''}><summary><strong>${shortDate(w.id)}週 <span class="pill ${i===0?'blue':'gray'}">${i===0?'最新':i===1?'前週':'過去'}</span></strong><span class="history-line">${e(w.team.status)||'まだ記入されていません'}</span><span class="history-kpi">CVR ${cvr(w.metrics.teamCvr)}% · 配信 ${initiativeMetricsKnown(w)?w.metrics.dispatched:'—'}/9</span></summary><div class="history-content"><div class="history-metrics"><span>3Q累計CVR<strong>${cvr(w.metrics.teamCvr)}%</strong></span><span>前週記事CVR<strong>${cvr(w.metrics.previousWeekCvr)}%</strong></span><span>配信<strong>${initiativeMetricsKnown(w)?w.metrics.dispatched:'—'}/9件</strong></span><span>集計 ${formatTime(w.metrics.asOf)}</span><span>売上 ${w.metrics.monthlyRevenue?.some(r=>r.actual!=null)?w.metrics.monthlyRevenue.filter(r=>r.actual!=null).map(r=>shortDate(r.month+'-01').split('/')[0]+'月 '+money(r.actual)+'億円').join(' · '):'未記録'}</span></div><div class="history-grid">${[['status','今の状態'],['change','変化と理由'],['issues','案件課題'],['priorities','優先事項'],['requests','相談・判断依頼']].map(([k,l])=>`<div><h4>${l}</h4><p>${e(w.team[k])||'未記入'}</p></div>`).join('')}</div><details class="history-member"><summary>個人・定性の記録を開く</summary>${PEOPLE.map(p=>`<pre><strong>${p.name}</strong>　CVR ${cvr(w.metrics.people[p.id]?.cvr)}%　立案 ${initiativeMetricsKnown(w)?w.metrics.people[p.id]?.proposals??0:'—'}件\n振り返り：${e(w.members[p.id]?.reflection)||'未記入'}\nFBの学び：${e(w.members[p.id]?.feedback)||'未記入'}\n次の行動：${e(w.members[p.id]?.action)||'未記入'}</pre>`).join('')}${w.qualitative.map(q=>`<pre><strong>${e(QUALITATIVE.find(x=>x.id===q.id)?.label)||e(q.id)}</strong>　${statusLabel(q.status)}\n${e(q.evidence)||'未記入'}\n次の行動：${e(q.next)||'未記入'}</pre>`).join('')}</details><button class="text-link" data-action="select-week" data-week="${w.id}" style="margin-top:14px">この週を表示・編集する →</button></div></details>`).join('')}</div></section>`;}
function safeUrl(url){try{const parsed=new URL(url);return ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password;}catch{return false;}}
function alerts(){
 let html=offlineMessage?`<div class="alert warn"><div>${e(offlineMessage)} 入力はこのタブの下書きとして保持します。</div><button class="button small" data-action="reconnect">接続を再確認</button></div>`:'';
 if(availableDrafts.length)html+=`<details class="alert draft-list"><summary>別のタブ・前回の下書き ${availableDrafts.length}件（現在の入力とは別に保管）</summary>${availableDrafts.map(d=>`<div class="draft-list-row"><span>${e(formatTime(d.savedAt))} · ${Object.keys(d.drafts||{}).length}欄</span><button class="button small" data-action="resume-draft" data-draft="${e(d.storageKey)}">この下書きを取り込む</button><button class="text-link" data-action="download-stored" data-draft="${e(d.storageKey)}">ダウンロード</button></div>`).join('')}</details>`;
 if(readStored(LEGACY_KEY))html+=`<div class="alert">以前の全体編集形式の下書きを保持しています。<button class="text-link" data-action="download-stored" data-draft="${LEGACY_KEY}">以前の下書きをダウンロード</button></div>`;
 html+=Object.entries(blockDrafts).filter(([,d])=>d.path[0]==='monthlyRevenue').map(([key])=>`<div class="alert warn"><div>以前の売上下書きを保持しています。売上はAXADから更新するため、この下書きは保存できません。</div><button class="text-link" data-action="download-draft">下書きをダウンロード</button><button class="button small" data-action="discard-block" data-block="${e(key)}">売上下書きを戻す</button></div>`).join('');
 html+=Object.entries(blockDrafts).filter(([,d])=>d.mine===undefined||d.error?.includes('親')).map(([key,d])=>`<div class="alert warn"><div>未保存の記録 ${e(d.path.map(x=>typeof x==='object'?x.id:x).join(' / '))}${d.mine===undefined?'（削除）':''}</div>${blockActions(d.path,'この記録を保存')}</div>`).join('');
 return html+conflictPanel();
}
function conflictPanel(){
 const val=(v,deleted)=>deleted?'削除':typeof v==='object'?JSON.stringify(v):String(v??'未入力');
 return Object.entries(blockDrafts).filter(([,d])=>d.conflicts?.length).map(([key,d])=>`<div class="card conflict-panel"><h3>この欄の内容が競合しています</h3><p>自分と最新の内容を選んでから、この欄だけを保存してください。他の欄は続けて入力できます。</p>${d.conflicts.map((c,i)=>`<div class="conflict-row"><strong>${e(c.path.map(s=>typeof s==='object'?s.id:s).join(' / '))}</strong><div class="conflict-options"><div><h4>自分の下書き</h4><pre>${e(val(c.mine,c.mineDelete))}</pre><button class="button small" data-action="choose-conflict" data-block="${e(key)}" data-conflict="${i}" data-choice="mine">自分の内容を採用</button></div><div><h4>最新の共有内容</h4><pre>${e(val(c.theirs,c.theirsDelete))}</pre><button class="button small" data-action="choose-conflict" data-block="${e(key)}" data-conflict="${i}" data-choice="theirs">最新の内容を採用</button></div></div></div>`).join('')}</div>`).join('');
}
function render(){
 const week=currentWeek();activeWeek=week.id;const wi=state.weeks.findIndex(w=>w.id===activeWeek);document.body.classList.add('block-editing');const latest=[...state.weeks].sort((a,b)=>b.id.localeCompare(a.id))[0];
 main.innerHTML=`<div class="week-toolbar"><div class="week-control"><label for="week-selector">表示する週</label><select id="week-selector" class="week-select">${[...state.weeks].sort((a,b)=>b.id.localeCompare(a.id)).map(w=>`<option value="${w.id}" ${w.id===activeWeek?'selected':''}>${shortDate(w.id)}週${w.id===latest.id?' · 最新':''}</option>`).join('')}</select><button class="button small edit-only" data-action="show-week-form">＋ 週を追加</button></div></div>${alerts()}${!sharedState.weeks.some(w=>w.id===week.id)?`<div class="alert">この週はまだ共有されていません。${blockActions(['weeks',{key:'id',id:week.id}],'この週を共有')}</div>`:''}${activeWeek!==latest.id?'<div class="alert archive-notice">過去週を表示しています。過去週の文章を編集できます。集計値は当時のスナップショットを保持します。</div>':''}<div class="editor-row"><label for="editor-name">更新者</label><input class="simple" id="editor-name" value="${e(editor)}" placeholder="名前を記入" maxlength="80"><span class="edit-warning">下書きはタブごと・欄ごとに保管。その欄の保存ボタンで共有します。</span><button class="text-link align-end" data-action="download-draft">下書きをダウンロード</button></div><div id="new-week-form" class="week-form" hidden><label for="new-week-date" class="subtle">報告週の月曜日</label><input type="date" class="simple" id="new-week-date" value="${nextMonday(latest.id)}"><button class="button small primary" data-action="add-week">週を作成</button><button class="button small" data-action="hide-week-form">閉じる</button></div>${overview(week)}${report(week,wi)}${initiativeSection()}${articleSection(week)}${memberSection(week,wi)}${history()}`;
 // hidden wins over author display rules for the optional add-week form.
 document.querySelector('#new-week-form').style.display='none';updateSaveStatus();
}
function updateSaveStatus(){
 dirty=Object.keys(blockDrafts).length>0;
 const label=document.querySelector('#save-state');label.textContent=savingKey?'欄を保存中…':syncing?'最新を確認中…':dirty?`未保存 ${Object.keys(blockDrafts).length}欄`:state?.updatedAt?`保存 ${formatTime(state.updatedAt)}`:'未保存';label.classList.toggle('dirty',dirty);
 main.querySelectorAll('[data-block]').forEach(el=>{const key=el.dataset.block,d=blockDrafts[key];el.disabled=syncing||key===savingKey||!!d?.pendingSave&&el.dataset.action!=='save-block'&&el.dataset.action!=='discard-block';if(el.dataset.action==='save-block')el.disabled=!apiReady||!!savingKey||syncing||!d||!!d.conflicts?.length;});
 main.querySelectorAll('[data-block-actions]').forEach(el=>{const key=el.dataset.blockActions,d=blockDrafts[key];const label=el.querySelector('.block-status');if(label)label.textContent=key===savingKey?'保存中…':d?.conflicts?.length?'内容の選択が必要':d?.error|| (d?'この欄は未保存':'共有済み');});
 document.querySelector('#refresh-button').disabled=!!savingKey||syncing;
}
function readStored(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function storeDraft(){try{if(Object.keys(blockDrafts).length)localStorage.setItem(OWN_DRAFT_KEY,JSON.stringify({schemaVersion:2,drafts:blockDrafts,activeWeek,editor,savedAt:new Date().toISOString(),tabId:TAB_ID}));else localStorage.removeItem(OWN_DRAFT_KEY);}catch{toast('端末の下書き保存ができません。下書きをダウンロードしてください。');}}
function scanDrafts(){availableDrafts=[];try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(DRAFT_KEY)&&key!==OWN_DRAFT_KEY){const d=readStored(key);if(d?.schemaVersion===2&&d.drafts)availableDrafts.push({...d,storageKey:key});}}}catch{}}
function rebuildView(){state=overlayBlockDrafts(sharedState,blockDrafts);}
function preserveArticleMeasurements(draft,fresh){
 if(draft.path[0]!=='articles'||draft.mine===undefined||typeof draft.mine!=='object')return;
 const id=draft.path[1].id,live=fresh.articles.find(a=>a.id===id),base=draft.baseState.articles.find(a=>a.id===id),fields=['metaCv','metaClicks','observedThrough'];
 for(const field of fields){draft.mine[field]=live?.[field]??null;if(base)base[field]=live?.[field]??null;}
 draft.conflicts=(draft.conflicts||[]).filter(c=>!fields.includes(c.path.at(-1)));
}
function acceptShared(fresh,except=''){
 sharedState=structuredClone(fresh.state);revision=fresh.revision;
 for(const [key,d] of Object.entries(blockDrafts)){
  if(key===except)continue;preserveArticleMeasurements(d,sharedState);const merged=mergeBlockDraft(d,sharedState);
  if(merged.parentMissing){d.error='共有側でこの欄の親記録が削除されています。下書きをダウンロードして確認してください。';continue;}
  d.baseState=structuredClone(sharedState);d.mine=blockValue(merged.state,d.path);d.conflicts=merged.conflicts;
 }
 rebuildView();storeDraft();
}
function updateBlockFromInput(key){const scope=JSON.parse(decodeURIComponent(key));if(!blockDrafts[key])blockDrafts[key]=makeBlockDraft(sharedState,scope);const d=blockDrafts[key];d.mine=blockValue(state,scope);d.error='';storeDraft();updateSaveStatus();}
function toast(text){const t=document.querySelector('#toast');t.textContent=text;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,4500);}
async function request(url,options={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),60000);try{const response=await fetch(url,{...options,signal:controller.signal,cache:'no-store'});let data;try{data=await response.json();}catch{data={};}if(!response.ok){const err=new Error(data.error||data.message||`HTTP ${response.status}`);err.status=response.status;throw err;}return data;}finally{clearTimeout(timer);}}
async function apiGet(){return request(config.apiBase.replace(/\/$/,'')+'/api/state');}
async function refreshAxadData(){
 axadData=null;importStatus=null;
 try{const data=await request('./axad-data.json');if(data.schemaVersion===1&&data.media==='META'&&Array.isArray(data.articles)){
  axadData=data;importStatus={asOf:data.asOf,fetchedAtJst:data.fetchedAtJst,populationComplete:data.populationComplete,note:(data.notes||[]).join(' ')};
 }}catch{}
}
async function boot(){
 try{config=await request('./config.json');}catch{config={apiBase:'',repo:'usukura-P/conversion-design-q3-2026',branch:'codex/3q-dashboard'};}
 try{if(!config.apiBase)throw new Error('保存APIを準備中です。');const data=await apiGet();state=data.state;revision=data.revision;apiReady=true;}catch(err){apiReady=false;offlineMessage=err.message==='保存APIを準備中です。'?err.message:'保存サーバーとの通信に失敗しました。';try{state=await request('./data/state.json');}catch{try{state=await request(`https://raw.githubusercontent.com/${config.repo}/${config.branch}/data/state.json`);}catch(fallback){main.innerHTML=`<div class="error-page">進捗を読み込めませんでした。通信状態を確認して再読み込みしてください。<br>${e(fallback.message)}<br><button class="button" data-action="reload">再読み込み</button></div>`;return;}}}
 await refreshAxadData();
 sharedState=structuredClone(state);activeWeek=[...state.weeks].sort((a,b)=>b.id.localeCompare(a.id))[0].id;try{editor=localStorage.getItem(DRAFT_KEY+'editor')||localStorage.getItem(LEGACY_KEY+'-editor')||'';}catch{}scanDrafts();
 render();
}
async function saveBlock(key){
 const draft=blockDrafts[key];if(!draft||!apiReady||savingKey||syncing)return;
 preserveArticleMeasurements(draft,sharedState);if(draft.conflicts?.length)return;
 if(draft.path[0]==='monthlyRevenue'){draft.error='売上はAXAD取得で更新します。この古い下書きは保存できません。';storeDraft();toast(draft.error);return;}
 if(draft.pendingSave&&draft.axadGuardVersion!==1){draft.pendingSave=null;draft.error='古い保存内容の再送を止めました。AXADの最新値を保持して、もう一度この欄を保存してください。';storeDraft();render();return;}
 if(!editor.trim()){document.querySelector('#editor-name').focus();toast('更新者名を記入してください。');return;}
 savingKey=key;updateSaveStatus();
 try{
  if(!draft.pendingSave){
   const fresh=await apiGet(),safeDraft=structuredClone(draft);
   preserveArticleMeasurements(safeDraft,fresh.state);
   const merged=mergeBlockDraft(safeDraft,fresh.state);
   merged.state.monthlyRevenue=structuredClone(fresh.state.monthlyRevenue);
   for(const article of merged.state.articles){const live=fresh.state.articles.find(a=>a.id===article.id);for(const field of ['metaCv','metaClicks','observedThrough'])article[field]=live?.[field]??null;}
   if(merged.parentMissing){draft.error='親の記録が共有側で削除されています。下書きを保管して確認してください。';storeDraft();render();return;}
   acceptShared(fresh,key);draft.baseState=structuredClone(fresh.state);draft.mine=blockValue(merged.state,draft.path);draft.conflicts=merged.conflicts;rebuildView();
   if(draft.conflicts.length){draft.error='同じ欄が更新されています。両方の内容を確認してください。';storeDraft();render();return;}
   if(merged.state.articles.some(a=>a.initiativeId&&!merged.state.initiatives.some(i=>i.id===a.initiativeId))){draft.error='関連施策を選び直してから保存してください。';storeDraft();render();return;}
   const weekId=draft.path[0]==='weeks'?draft.path[1].id:sharedState.weeks.map(w=>w.id).sort().at(-1);
   const latestObservation=[...fresh.state.weeks].sort((a,b)=>b.id.localeCompare(a.id)).find(w=>w.metrics.asOf)?.metrics.asOf||null;
   const observedRaw=latestObservation||(axadData?.fetchedAtJst&&merged.state.articles.some(a=>matchAxadArticle(a,axadData).status==='matched')?axadData.fetchedAtJst:null);
   const observedAt=observedRaw?new Date(observedRaw).toISOString():null;
   const prepared=prepareSave(merged.state,weekId,observedAt||new Date().toISOString());
   if(weekId===prepared.weeks.map(w=>w.id).sort().at(-1)){
    const m=prepared.weeks.find(w=>w.id===weekId).metrics,currentCounts=calculateMetrics(merged.state,merged.state.weeks.find(w=>w.id===weekId),new Date().toISOString());
    m.dispatched=currentCounts.dispatched;for(const p of PEOPLE)m.people[p.id].proposals=currentCounts.people[p.id].proposals;
   }
   if(!observedAt&&weekId===prepared.weeks.map(w=>w.id).sort().at(-1)){const m=prepared.weeks.find(w=>w.id===weekId).metrics;m.asOf=null;m.teamCvr=null;m.previousWeekCvr=null;m.eligibleArticles=0;m.unmeasurableArticles=0;for(const p of Object.values(m.people))p.cvr=null;}
   draft.pendingSave={state:prepared,revision:fresh.revision,requestId:crypto.randomUUID(),editor:editor.trim()};draft.axadGuardVersion=1;storeDraft();
  }
  const result=await request(config.apiBase.replace(/\/$/,'')+'/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft.pendingSave)});
  delete blockDrafts[key];acceptShared(result);draft.error='';offlineMessage='';toast('この欄を共有しました。他の未保存欄は下書きのままです。');render();
 }catch(err){
  if(err.status===409){draft.pendingSave=null;try{const fresh=await apiGet();acceptShared(fresh);}catch{}draft.error='他の更新が先に保存されました。確認してこの欄を保存してください。';}
  else if(err.status>=400&&err.status<500){draft.pendingSave=null;draft.error=`入力を確認してください：${err.message}`;}
  else draft.error=`保存できませんでした：${err.message}。下書きを保持しています。`;
  storeDraft();render();
 }finally{savingKey='';updateSaveStatus();}
}
function downloadJson(value,name){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function downloadDraft(){const out=exportBlockDrafts(sharedState,blockDrafts);downloadJson({...out,revision,activeWeek,editor,exportedAt:new Date().toISOString()},`3q-draft-${activeWeek}-${TAB_ID.slice(0,8)}.json`);}
main.addEventListener('input',event=>{
 const el=event.target;if(syncing||el.dataset.block===savingKey||blockDrafts[el.dataset.block]?.pendingSave)return;
 if(el.id==='editor-name'){editor=el.value;try{localStorage.setItem(DRAFT_KEY+'editor',editor);}catch{}storeDraft();return;}
 if(!el.dataset.path)return;
 const path=JSON.parse(decodeURIComponent(el.dataset.valuePath));let value=el.value;if(el.dataset.type==='number')value=value===''?null:Number(value);else if(el.dataset.type==='date')value=value||null;if(path.at(-1)==='initiativeId')value=value||null;
 if(!setBlockValue(state,path,value)){toast('共有側で記録が削除されています。入力を下書きダウンロードに保管して確認してください。');return;}updateBlockFromInput(el.dataset.block);
});
main.addEventListener('change',event=>{if(syncing)return;if(event.target.id==='week-selector'){activeWeek=event.target.value;render();}else if(event.target.matches('select[data-path]'))event.target.dispatchEvent(new Event('input',{bubbles:true}));});
async function refreshShared(){if(savingKey||syncing)return;syncing=true;updateSaveStatus();try{if(!config.apiBase)config=await request('./config.json');const fresh=await apiGet();await refreshAxadData();acceptShared(fresh);apiReady=true;offlineMessage='';scanDrafts();render();toast('最新状態を確認しました。各欄の下書きは保持しています。');}catch(err){offlineMessage=`接続できませんでした：${err.message}`;render();}finally{syncing=false;updateSaveStatus();}}
main.addEventListener('click',async event=>{
 const button=event.target.closest('[data-action]');const jump=event.target.closest('[data-jump-week]');if(jump){const d=document.querySelector('#week-'+jump.dataset.jumpWeek);if(d)d.open=true;return;}if(!button)return;
 const action=button.dataset.action,key=button.dataset.block;if(syncing||key===savingKey)return;
 if(action==='save-block'){await saveBlock(key);return;}
 if(action==='download-draft'){downloadDraft();return;}if(action==='download-stored'){const d=readStored(button.dataset.draft);if(d)downloadJson(d,'3q-stored-draft.json');return;}
 if(action==='reconnect'){await refreshShared();return;}if(action==='reload'){location.reload();return;}
 if(action==='discard-block'){if(savingKey||!confirm('この欄の下書きを戻しますか？ 他の欄には影響しません。'))return;delete blockDrafts[key];rebuildView();storeDraft();render();return;}
 if(action==='choose-conflict'){const d=blockDrafts[key];if(d&&chooseBlockConflict(d,Number(button.dataset.conflict),button.dataset.choice)){d.error='';rebuildView();storeDraft();render();}return;}
 if(action==='resume-draft'){
  if(savingKey)return;const saved=readStored(button.dataset.draft);if(!saved?.drafts)return;
  // Combining two unsaved versions of the same block requires an explicit choice.
  for(const [k,d] of Object.entries(saved.drafts)){
   if(blockDrafts[k]){toast('同じ欄に現在の下書きがあります。ダウンロードして比較するか、現在の欄を保存・戻してから取り込んでください。');return;}
  }
  for(const [k,d] of Object.entries(saved.drafts)){blockDrafts[k]=structuredClone(d);}
  editor=editor||saved.editor||'';acceptShared({state:sharedState,revision});storeDraft();render();toast('選んだ下書きを取り込みました。元の保管分も保持しています。');return;
 }
 if(action==='show-week-form'){const f=document.querySelector('#new-week-form');f.hidden=false;f.style.display='flex';return;}if(action==='hide-week-form'){const f=document.querySelector('#new-week-form');f.hidden=true;f.style.display='none';return;}
 if(action==='add-week'){
  const date=document.querySelector('#new-week-date').value;if(!date||mondayFor(date)!==date){toast('報告週の月曜日を選んでください。');return;}if(state.weeks.some(w=>w.id===date)){toast('この週はすでにあります。');return;}
  const path=['weeks',{key:'id',id:date}],key=keyFor(path),d=makeBlockDraft(sharedState,path);d.mine=createWeek(date);blockDrafts[key]=d;rebuildView();activeWeek=date;storeDraft();render();toast('新しい週の下書きを作りました。「この週を共有」で保存します。');return;
 }
 if(action==='add-initiative'||action==='add-article'){
  const collection=action==='add-initiative'?'initiatives':'articles',id=crypto.randomUUID(),path=[collection,{key:'id',id}],key=keyFor(path),d=makeBlockDraft(sharedState,path);
  d.mine=collection==='initiatives'?{id,title:'',owner:'aoki',stage:'idea',meetingDate:null,dispatchDate:null,deadline:null,evidence:'',background:'',craft:'',feedback:'',learning:'',next:'',url:''}:{id,title:'',owner:'aoki',releaseDate:currentWeek().releaseStart,metaCv:null,metaClicks:null,observedThrough:null,initiativeId:null};
  blockDrafts[key]=d;rebuildView();storeDraft();render();return;
 }
 if(action==='delete-initiative'||action==='delete-article'){
  if(savingKey||!confirm('この記録だけを削除して共有しますか？'))return;
  const collection=action==='delete-initiative'?'initiatives':'articles',row=state[collection][Number(button.dataset.index)];if(!row)return;
  if(collection==='initiatives'&&state.articles.some(a=>a.initiativeId===row.id)){toast('この記事に関連する施策を先に各記事欄で解除して保存してください。');return;}
  const path=[collection,{key:'id',id:row.id}],k=keyFor(path),d=blockDrafts[k]||makeBlockDraft(sharedState,path);d.mine=undefined;d.pendingSave=null;d.conflicts=[];blockDrafts[k]=d;storeDraft();await saveBlock(k);rebuildView();render();return;
 }
 if(action==='select-week'){activeWeek=button.dataset.week;render();document.querySelector('#overview').scrollIntoView({behavior:'smooth'});}
});
document.querySelector('#refresh-button').addEventListener('click',refreshShared);
window.addEventListener('beforeunload',event=>{if(Object.keys(blockDrafts).length){event.preventDefault();event.returnValue='';}});
window.addEventListener('storage',event=>{if(event.key?.startsWith(DRAFT_KEY)&&event.key!==OWN_DRAFT_KEY)scanDrafts();});
let clockTimer=null;
const clockDateFormatter=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
const clockTimeFormatter=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function updateCurrentJst(){
 const now=new Date(),text=clockDateFormatter.format(now)+'\n'+clockTimeFormatter.format(now);
 document.querySelectorAll('[data-current-jst]').forEach(el=>{el.textContent=text;el.dateTime=now.toISOString();});
 clearTimeout(clockTimer);clockTimer=setTimeout(updateCurrentJst,60000-now.getTime()%60000);
}
updateCurrentJst();
const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)document.querySelectorAll('.sidebar nav a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+entry.target.id));},{rootMargin:'-10% 0px -70% 0px'});
boot().then(()=>document.querySelectorAll('section[id]').forEach(s=>observer.observe(s)));
