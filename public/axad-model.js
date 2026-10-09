const RAW_KEYS=['spend','impressions','clicks','mcv','cv','revenue','profit'];
const known=value=>typeof value==='number'&&Number.isFinite(value);
const ratio=(a,b,scale=1)=>known(a)&&known(b)&&b>0?a/b*scale:null;
export function performanceMetrics(raw={}){
 const r=Object.fromEntries(RAW_KEYS.map(k=>[k,known(raw?.[k])?raw[k]:null]));
 return {...r,roas:ratio(r.revenue,r.spend,100),cpa:r.cv===0&&known(r.spend)?0:ratio(r.spend,r.cv),cpm:ratio(r.spend,r.impressions,1000),ctr:ratio(r.clicks,r.impressions,100),cpc:ratio(r.spend,r.clicks),mcvr:ratio(r.mcv,r.clicks,100),mcpa:ratio(r.spend,r.mcv),cvr:ratio(r.cv,r.mcv,100),realCvr:ratio(r.cv,r.clicks,100)};
}
export function sumRawMetrics(rows){
 return Object.fromEntries(RAW_KEYS.map(k=>[k,rows.length&&rows.every(r=>known(r?.[k]))?rows.reduce((sum,r)=>sum+r[k],0):null]));
}
export function matchAxadArticle(article,data,observedThrough=null){
 if(!data||data.media!=='META')return {status:'missing',raw:null};
 const matches=(data.articles||[]).filter(r=>['id','title','owner','releaseDate'].every(k=>r[k]===article[k]));
 if(matches.length!==1)return {status:'unmatched',raw:null};
 const row=matches[0];
 if(observedThrough&&row.observedThrough!==observedThrough)return {status:'historical_missing',raw:null};
 if(row.observedThrough!==article.observedThrough)return {status:'unmatched',raw:null};
 if(row.metrics?.cv!==article.metaCv||row.metrics?.clicks!==article.metaClicks)return {status:'unmatched',raw:null};
 return {status:'matched',raw:row.metrics,source:row};
}
export function jstObservationDate(value){
 if(!value)return null;const d=new Date(value);if(!Number.isFinite(d.getTime()))return null;
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
export function trendPoints(data,weeks=[],member=null){
 const valueFor=row=>member&&member!=='usukura'?row.people?.[member]:row.teamCvr;
 const fromRaw=(row,segment)=>({...row,segment,value:known(valueFor(row))?valueFor(row):null,week:null,source:'axad'});
 const september=(data?.trend?.basis==='article_mean'?data.trend.september||[]:[]).map(r=>fromRaw(r,'september'));
 const quarter=new Map((data?.trend?.basis==='article_mean'?data.trend.quarter||[]:[]).map(r=>[r.observedThrough,fromRaw(r,'quarter')]));
 // A recorded report keeps its own value; reference imports cannot rewrite history.
 for(const week of [...weeks].sort((a,b)=>a.id.localeCompare(b.id))){
  const m=week.metrics,observedThrough=jstObservationDate(m?.asOf);if(!observedThrough||observedThrough<'2026-10-01'||observedThrough>'2026-12-31')continue;
  const value=member&&member!=='usukura'?m.people?.[member]?.cvr:m.teamCvr;
  const row={releaseStart:'2026-10-01',releaseEnd:observedThrough,observedThrough,eligibleArticles:m.eligibleArticles,value:known(value)?value:null,segment:'quarter',week:week.id,source:'snapshot'};
  const existing=quarter.get(observedThrough);if(existing?.source==='snapshot')continue;quarter.set(observedThrough,row);
 }
 return [...september.sort((a,b)=>a.observedThrough.localeCompare(b.observedThrough)),...[...quarter.values()].sort((a,b)=>a.observedThrough.localeCompare(b.observedThrough))];
}
