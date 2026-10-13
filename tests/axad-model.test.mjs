import test from 'node:test';
import assert from 'node:assert/strict';
import {performanceMetrics,sumRawMetrics,matchAxadArticle,matchArticlePerformance,articlePerformanceMetrics,articlePerformanceTotals,trendPoints} from '../public/axad-model.js';

const raw={spend:43333,impressions:5000,clicks:121,mcv:32,cv:4,revenue:80000,profit:36667};
test('AXAD ratios distinguish CV/MCV from effective CV/clicks',()=>{
 const m=performanceMetrics(raw);assert.equal(m.cvr,12.5);assert.equal(m.realCvr,4/121*100);assert.equal(m.mcvr,32/121*100);assert.equal(m.cpa,43333/4);assert.equal(m.mcpa,43333/32);assert.equal(m.roas,80000/43333*100);assert.equal(m.cpm,43333/5000*1000);assert.equal(m.ctr,121/5000*100);assert.equal(m.cpc,43333/121);
});
test('zero CV CPA follows AXAD; missing inputs and other zero denominators stay unknown',()=>{
 assert.equal(performanceMetrics({...raw,cv:0}).cpa,0);assert.equal(performanceMetrics({...raw,cv:0,spend:null}).cpa,null);assert.equal(performanceMetrics({...raw,clicks:0}).realCvr,null);assert.equal(performanceMetrics({...raw,mcv:0}).cvr,null);assert.equal(performanceMetrics({...raw,spend:0}).roas,null);
});
test('totals sum raw counts, preserve negative profit and recompute ratios',()=>{
 const totals=sumRawMetrics([raw,{...raw,spend:100,clicks:1000,cv:0,profit:-100}]);assert.equal(totals.profit,36567);assert.equal(performanceMetrics(totals).realCvr,4/1121*100);assert.equal(sumRawMetrics([raw,{...raw,spend:null}]).spend,null);assert.equal(sumRawMetrics([]).cv,null);assert.equal(sumRawMetrics([raw,null]).cv,null);
});
test('article identity and observation date must match read-only AXAD details',()=>{
 const a={id:'a',title:'記事',owner:'aoki',releaseDate:'2026-10-01',observedThrough:'2026-10-09',metaCv:4,metaClicks:121};const data={media:'META',articles:[{...a,metrics:raw}]};assert.equal(matchAxadArticle(a,data).status,'matched');for(const key of ['id','title','owner','releaseDate','observedThrough','metaCv','metaClicks'])assert.equal(matchAxadArticle({...a,[key]:'different'},data).status,'unmatched');assert.equal(matchAxadArticle(a,data,'2026-10-04').status,'historical_missing');assert.equal(matchAxadArticle(a,null).status,'missing');
});
test('cumulative chart separates September and quarter and preserves saved snapshots at duplicate cutoffs',()=>{
 const data={trend:{basis:'article_mean',september:[{releaseStart:'2026-09-01',releaseEnd:'2026-09-06',observedThrough:'2026-09-06',teamCvr:1,eligibleArticles:2,people:{aoki:2,usukura:1}}],quarter:[{releaseStart:'2026-10-01',releaseEnd:'2026-10-09',observedThrough:'2026-10-09',teamCvr:3,eligibleArticles:7,people:{aoki:4,usukura:3}}]}};const weeks=[{id:'2026-10-12',metrics:{asOf:'2026-10-09T04:00:00Z',teamCvr:1.3,eligibleArticles:7,people:{aoki:{cvr:1.8},usukura:{cvr:1.3}}}}];const p=trendPoints(data,weeks);assert.equal(p.length,2);assert.equal(p[0].segment,'september');assert.equal(p[1].segment,'quarter');assert.equal(p[1].value,1.3);assert.equal(p[1].week,'2026-10-12');assert.equal(trendPoints(data,weeks,'aoki')[1].value,1.8);assert.equal(trendPoints(data,weeks,'usukura')[1].value,1.3);assert.equal(weeks[0].metrics.teamCvr,1.3);
});
test('missing reference data draws only real saved quarter snapshots, never inventing September',()=>{
 const weeks=[{id:'2026-10-12',metrics:{asOf:null,teamCvr:null}},{id:'2026-10-19',metrics:{asOf:'2026-10-18T16:00:00Z',teamCvr:2,eligibleArticles:2,people:{}}}];const p=trendPoints(null,weeks);assert.equal(p.length,1);assert.equal(p[0].observedThrough,'2026-10-19');assert.equal(p[0].releaseEnd,'2026-10-19');assert.equal(p[0].week,'2026-10-19');
});

const allRaw={spend:50000,impressions:7000,clicks:250,mcv:50,cv:10,revenue:150000,profit:-250};
const article={id:'a',title:'記事',owner:'aoki',releaseDate:'2026-10-01',observedThrough:'2026-10-13',metaCv:4,metaClicks:121};
function dualData(){return {schemaVersion:1,media:'ALL',asOf:'2026-10-13',articles:[{...article,allMediaMetrics:allRaw,metaMetrics:raw}]};}
test('dual performance derives all-media cells and separate Meta KPI, even when saved KPI counts are older',()=>{
 const match=matchArticlePerformance({...article,metaCv:1},dualData());assert.equal(match.status,'matched');const m=articlePerformanceMetrics(match);assert.equal(m.spend,50000);assert.equal(m.clicks,250);assert.equal(m.cvr,20);assert.equal(m.realCvr,4);assert.equal(m.metaRealCvr,4/121*100);assert.equal(m.profit,-250);
});
test('dual totals recompute each media ratio from own counts, never mean article ratios',()=>{
 const second={status:'matched',raw:{...allRaw,clicks:750,cv:0},metaRaw:{...raw,clicks:879,cv:0}};
 const m=articlePerformanceTotals([matchArticlePerformance(article,dualData()),second]);assert.equal(m.realCvr,1);assert.equal(m.metaRealCvr,0.4);assert.equal(m.clicks,1000);assert.equal(m.cv,10);
 assert.equal(articlePerformanceTotals([]).realCvr,null);assert.equal(articlePerformanceTotals([second,{raw:null,metaRaw:null}]).metaRealCvr,null);
});
test('dual sources reject mismatched identity, ambiguous records and observation dates without Meta fallback',()=>{
 for(const key of ['id','title','owner','releaseDate','observedThrough'])assert.equal(matchArticlePerformance({...article,[key]:'different'},dualData()).status,'unmatched');
 assert.equal(matchArticlePerformance(article,dualData(),'2026-10-09').status,'historical_missing');
 const ambiguous=dualData();ambiguous.articles.push({...ambiguous.articles[0],title:'異なる記事'});assert.equal(matchArticlePerformance(article,ambiguous).status,'unmatched');
 for(const data of [null,{...dualData(),schemaVersion:2},{...dualData(),media:'META'},{...dualData(),asOf:'2026-10-12'}])assert.notEqual(matchArticlePerformance(article,data).status,'matched');
 const absent=dualData();delete absent.articles[0].allMediaMetrics;assert.equal(matchArticlePerformance(article,absent).raw,null);
 const invalid=dualData();invalid.articles[0].allMediaMetrics={...allRaw,spend:-1};assert.equal(matchArticlePerformance(article,invalid).raw,null);
});
test('Meta zero clicks remains unknown and known zero CV remains zero independently of all-media',()=>{
 const d=dualData();d.articles[0].metaMetrics={...raw,clicks:0,cv:0};let m=articlePerformanceMetrics(matchArticlePerformance(article,d));assert.equal(m.realCvr,4);assert.equal(m.metaRealCvr,null);
 d.articles[0].metaMetrics={...raw,clicks:100,cv:0};m=articlePerformanceMetrics(matchArticlePerformance(article,d));assert.equal(m.metaRealCvr,0);
 d.articles[0].allMediaMetrics={...allRaw,clicks:null};m=articlePerformanceMetrics(matchArticlePerformance(article,d));assert.equal(m.realCvr,null);assert.equal(m.metaRealCvr,0);
});
