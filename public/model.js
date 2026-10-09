export const PEOPLE = [
 {id:'usukura',name:'臼倉',role:'チームマネージャー',q2:2.46,proposalGoal:null,focus:'部署が目標を追える仕組みの改善',detail:'記事が確実に回る／売れている事実に基づいた方向性が立つ／制作の質が上がる',evaluation:'メンバー全員定量目標達成',context:'施策の立案・完成物に対するFBが多方面から多く入る'},
 {id:'kantake',name:'寒竹',role:'記事制作',q2:2.62,proposalGoal:3,focus:'制作力鬼強化',detail:'売れている事実に基づいた施策立案'},
 {id:'aoki',name:'青木',role:'記事制作',q2:2.17,proposalGoal:3,focus:'制作力鬼強化',detail:'売れている事実に基づいた施策立案。横展開時の元記事の要素分解、売れている理由の抽象化・転用の精度'},
 {id:'nakagawa',name:'中川',role:'記事制作',q2:2.62,proposalGoal:3,focus:'制作力鬼強化',detail:'FBから不足している点を特定し、行動と施策立案・制作に反映する'},
];
export const MONTHS=[{month:'2026-10',label:'10月',goal:715000000},{month:'2026-11',label:'11月',goal:800000000},{month:'2026-12',label:'12月',goal:885000000}];
export const GOALS={cvr:3,dispatched:9,quarterStart:'2026-10-01',quarterEnd:'2026-12-31'};
export const STAGES=[['idea','立案'],['meeting','優先度会議'],['agreed','戦略合意'],['production','制作'],['released','リリース'],['dispatched','配信'],['reviewed','振り返り']];
export const QUALITATIVE=[
 {id:'issues',label:'記事が課題の案件を毎週吸い上げる',description:'売上に対して記事が課題になっている案件が毎週吸い上がっている'},
 {id:'evidence',label:'売れている根拠から施策をつくる',description:'全ての施策が売れている根拠の組み合わせから生まれている'},
 {id:'feedback',label:'立案・制作のFBゼロ',description:'施策立案／制作のFBゼロ。レビュー済みで、FB担当者目線で修正不要と判定される状態'},
 {id:'knowledge',label:'発生〜リリースの構造をナレッジ化',description:'全ての施策の発生〜リリースまでの構造がナレッジとして蓄積される体制ができている'},
 {id:'onboarding',label:'新人採用・オンボーディング',description:'新人1名採用＆オンボーディング開始 → 新人オンボーディング完了'},
];
export const STATUS=[['not_started','未着手'],['in_progress','進行中'],['achieved','達成']];
export function dateOnly(value){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
function shift(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function mondayFor(date){const day=new Date(date+'T00:00:00Z').getUTCDay();return shift(date,-((day+6)%7));}
export function previousWeek(monday){const start=shift(monday,-7);return {start,end:shift(monday,-1)};}
export function nextMonday(monday){return shift(monday,7);}
export function inQuarter(date){return Boolean(date && date>=GOALS.quarterStart && date<=GOALS.quarterEnd);}
export function articleEvaluation(a){
 if(a.title.includes('貸し')||a.title.includes('修正'))return {status:'excluded',cvr:null};
 if(typeof a.metaClicks!=='number'||!Number.isFinite(a.metaClicks)||a.metaClicks<=0||typeof a.metaCv!=='number'||!Number.isFinite(a.metaCv)||a.metaCv<0)return {status:'unmeasurable',cvr:null};
 return {status:'eligible',cvr:a.metaCv/a.metaClicks*100};
}
export function summarizeArticles(articles){
 const all=articles.map(articleEvaluation);const valid=all.filter(x=>x.status==='eligible');
 return {cvr:valid.length?valid.reduce((sum,x)=>sum+x.cvr,0)/valid.length:null,eligible:valid.length,unmeasurable:all.filter(x=>x.status==='unmeasurable').length,excluded:all.filter(x=>x.status==='excluded').length};
}
export function createWeek(monday){
 const {start,end}=previousWeek(monday);
 return {id:monday,releaseStart:start,releaseEnd:end,team:{status:'',change:'',issues:'',priorities:'',requests:''},members:Object.fromEntries(PEOPLE.map(p=>[p.id,{reflection:'',feedback:'',action:''}])),qualitative:QUALITATIVE.map(q=>({id:q.id,status:'not_started',evidence:'',next:''})),metrics:{asOf:null,teamCvr:null,previousWeekCvr:null,eligibleArticles:0,unmeasurableArticles:0,dispatched:0,people:Object.fromEntries(PEOPLE.map(p=>[p.id,{cvr:null,proposals:0}]))}};
}
export function calculateMetrics(state,week,asOf=new Date().toISOString()){
 const cutoff=dateOnly(asOf);const articles=state.articles.filter(a=>inQuarter(a.releaseDate)&&a.releaseDate<=cutoff);const all=summarizeArticles(articles);
 const cohort=state.articles.filter(a=>a.releaseDate>=week.releaseStart&&a.releaseDate<=week.releaseEnd&&a.releaseDate<=cutoff);
 return {asOf,teamCvr:all.cvr,previousWeekCvr:summarizeArticles(cohort).cvr,eligibleArticles:all.eligible,unmeasurableArticles:all.unmeasurable,dispatched:state.initiatives.filter(i=>inQuarter(i.dispatchDate)&&i.dispatchDate<=cutoff).length,people:Object.fromEntries(PEOPLE.map(p=>[p.id,{cvr:p.id==='usukura'?all.cvr:summarizeArticles(articles.filter(a=>a.owner===p.id)).cvr,proposals:state.initiatives.filter(i=>i.owner===p.id&&inQuarter(i.meetingDate)&&i.meetingDate<=cutoff).length}]))};
}
export function prepareSave(state,activeWeekId,asOf=new Date().toISOString()){
 const copy=structuredClone(state);const week=copy.weeks.find(w=>w.id===activeWeekId);
 if(!week)throw new Error('対象週がありません');
 const latestId=copy.weeks.map(w=>w.id).sort().at(-1);
 if(activeWeekId===latestId){week.metrics=calculateMetrics(copy,week,asOf);week.metrics.monthlyRevenue=structuredClone(copy.monthlyRevenue);}
 return copy;
}
export function initialState(){
 return {schemaVersion:1,updatedAt:null,baseline:{septemberRevenue:554427123,septemberCvr:null,q2Cvr:null,people:PEOPLE.map(p=>({id:p.id,name:p.name,septemberCvr:null,q2Cvr:null})),articles:[],sources:[],notes:['9月・2QのCVRは新集計条件で確認中']},monthlyRevenue:MONTHS.map(m=>({month:m.month,actual:null,asOf:null})),articles:[],initiatives:[],weeks:[createWeek('2026-10-12')]};
}

// Shared metadata and saved snapshots never come from an old local draft. Normalize
// before comparing too, so snapshot-only drift cannot create deletion conflicts.
const cloneMergeValue=value=>value===undefined?undefined:structuredClone(value);
const sameMergeValue=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function withSharedSnapshots(state,base,theirs){
 const result=cloneMergeValue(state);
 result.baseline=cloneMergeValue(theirs.baseline);result.updatedAt=theirs.updatedAt;
 for(const week of result.weeks){
  const shared=theirs.weeks.find(w=>w.id===week.id)||base.weeks.find(w=>w.id===week.id);
  if(shared)week.metrics=cloneMergeValue(shared.metrics);
 }
 return result;
}
const editableConflict=conflict=>Array.isArray(conflict?.path)&&conflict.path.length>0&&conflict.path[0]!=='baseline'&&conflict.path[0]!=='updatedAt'&&!conflict.path.includes('metrics');
const pathStartsWith=(path,prefix)=>prefix.length<=path.length&&prefix.every((segment,i)=>sameMergeValue(segment,path[i]));
function conflictValue(state,path){
 let value=state;
 for(const segment of path){
  if(segment&&typeof segment==='object')value=Array.isArray(value)?value.find(row=>row?.[segment.key]===segment.id):undefined;
  else value=value&&Object.hasOwn(value,segment)?value[segment]:undefined;
 }
 return value;
}

// Three-way merge: preserve concurrent edits; conflicts require an explicit choice.
export function mergeStates(base,mine,theirs){
 const conflicts=[];const sharedBase=withSharedSnapshots(base,base,theirs),sharedMine=withSharedSnapshots(mine,base,theirs);
 function merge(b,m,t,path){
  if(sameMergeValue(m,b))return cloneMergeValue(t);if(sameMergeValue(t,b)||sameMergeValue(m,t))return cloneMergeValue(m);
  if(m&&t&&typeof m==='object'&&typeof t==='object'&&!Array.isArray(m)&&!Array.isArray(t)){
   const result={};for(const k of new Set([...Object.keys(b||{}),...Object.keys(m),...Object.keys(t)])){const value=merge(b?.[k],m[k],t[k],[...path,k]);if(value!==undefined)result[k]=value;}return result;
  }
  if(Array.isArray(m)&&Array.isArray(t)){
   const rows=[...(Array.isArray(b)?b:[]),...m,...t];
   const key=rows.every(x=>x&&typeof x==='object'&&'id' in x)?'id':rows.every(x=>x&&typeof x==='object'&&'month' in x)?'month':null;
   if(key){const map=v=>new Map((Array.isArray(v)?v:[]).map(x=>[x[key],x]));const bm=map(b),mm=map(m),tm=map(t);const result=[];for(const id of new Set([...tm.keys(),...mm.keys(),...bm.keys()])){const value=merge(bm.get(id),mm.get(id),tm.get(id),[...path,{key,id}]);if(value!==undefined)result.push(value);}return result;}
  }
  conflicts.push({path,mine:cloneMergeValue(m),theirs:cloneMergeValue(t),mineDelete:m===undefined,theirsDelete:t===undefined});return cloneMergeValue(t);
 }
 const result=merge(sharedBase,sharedMine,theirs,[]);
 return {state:result,conflicts:conflicts.filter(editableConflict)};
}

// A merged draft displays the shared alternative until the user chooses. Recover
// its pending local alternatives before merging again, then keep those choices
// explicit even if the newer shared revision only changed unrelated fields.
export function rebaseDraft(base,mine,theirs,unresolved=[]){
 let recovered=cloneMergeValue(mine);
 const pending=unresolved.filter(editableConflict).filter(conflict=>applyConflictChoice(recovered,conflict,'mine'));
 recovered=withSharedSnapshots(recovered,base,theirs);
 const result=mergeStates(base,recovered,theirs);
 for(const old of pending){
  if(result.conflicts.some(conflict=>pathStartsWith(old.path,conflict.path)))continue;
  const local=conflictValue(recovered,old.path),shared=conflictValue(theirs,old.path);
  if(sameMergeValue(local,shared))continue;
  const conflict={path:cloneMergeValue(old.path),mine:cloneMergeValue(local),theirs:cloneMergeValue(shared),mineDelete:local===undefined,theirsDelete:shared===undefined};
  // An existing whole-record choice replaces any newly generated child choices.
  result.conflicts=result.conflicts.filter(candidate=>!pathStartsWith(candidate.path,old.path));
  if(applyConflictChoice(result.state,conflict,'theirs'))result.conflicts.push(conflict);
 }
 return result;
}

// Missing ancestors mean that record has since been deleted. Never synthesize a
// partial row or throw while applying an obsolete nested conflict.
export function applyConflictChoice(state,conflict,choice){
 if(!editableConflict(conflict)||!['mine','theirs'].includes(choice))return false;
 const remove=choice==='mine'?conflict.mineDelete:conflict.theirsDelete;
 const value=remove?undefined:cloneMergeValue(choice==='mine'?conflict.mine:conflict.theirs);
 let parent=state;
 for(const segment of conflict.path.slice(0,-1)){
  parent=segment&&typeof segment==='object'?(Array.isArray(parent)?parent.find(row=>row?.[segment.key]===segment.id):undefined):(parent&&Object.hasOwn(parent,segment)?parent[segment]:undefined);
  if(!parent||typeof parent!=='object')return false;
 }
 const last=conflict.path.at(-1);
 if(last&&typeof last==='object'){
  if(!Array.isArray(parent))return false;
  const idx=parent.findIndex(row=>row?.[last.key]===last.id);
  if(remove){if(idx>=0)parent.splice(idx,1);}else if(idx>=0)parent[idx]=value;else parent.push(value);
 }else{
  if(!parent||typeof parent!=='object'||['__proto__','prototype','constructor'].includes(last))return false;
  if(remove)delete parent[last];else parent[last]=value;
 }
 return true;
}

// A block carries only its own editable path. Shared state is always the source
// for the save envelope; other local blocks never enter that envelope.
export function blockValue(state,path){return cloneMergeValue(conflictValue(state,path));}
export function setBlockValue(state,path,value){return applyConflictChoice(state,{path,mine:value,mineDelete:value===undefined},'mine');}
export function makeBlockDraft(shared,path){return {path:structuredClone(path),baseState:structuredClone(shared),mine:blockValue(shared,path),conflicts:[],pendingSave:null,error:''};}
export function mergeBlockDraft(draft,shared){
 const local=structuredClone(draft.baseState);
 if(!setBlockValue(local,draft.path,draft.mine))return {state:structuredClone(shared),conflicts:[],parentMissing:true};
 // A colleague deleting a parent is not permission to restore its old contents.
 if(conflictValue(shared,draft.path.slice(0,-1))===undefined)return {state:structuredClone(shared),conflicts:[],parentMissing:true};
 const result=rebaseDraft(draft.baseState,local,shared,draft.conflicts||[]);
 return {...result,parentMissing:false};
}
export function overlayBlockDrafts(shared,drafts){
 const view=structuredClone(shared);
 for(const draft of Object.values(drafts))setBlockValue(view,draft.path,draft.mine);
 return view;
}
export function chooseBlockConflict(draft,index,choice){
 const local=structuredClone(draft.baseState);setBlockValue(local,draft.path,draft.mine);
 if(!applyConflictChoice(local,draft.conflicts[index],choice))return false;
 draft.mine=blockValue(local,draft.path);draft.conflicts.splice(index,1);draft.pendingSave=null;return true;
}
export function exportBlockDrafts(shared,drafts){
 const mine=overlayBlockDrafts(shared,drafts);
 for(const draft of Object.values(drafts))for(const conflict of draft.conflicts||[])applyConflictChoice(mine,conflict,'mine');
 return {schemaVersion:2,shared:structuredClone(shared),mine,drafts:structuredClone(drafts)};
}
