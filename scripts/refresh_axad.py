#!/usr/bin/env python3
"""AXAD MCP用SELECT生成・読取結果整形。通常はdry-run、--applyのみAPI保存。"""
import argparse,copy,json,subprocess,sys,urllib.request,uuid,hashlib,re
from pathlib import Path
from datetime import date,datetime,timedelta,timezone
ROOT=Path(__file__).resolve().parents[1]
API='https://q3-progress-api-295429960025.asia-northeast1.run.app/api/state'
FIELDS=['spend','impressions','clicks','mcv','cv','revenue','profit']
PEOPLE=['usukura','kantake','aoki','nakagawa']
def quarter_cutoff(asof):return min(date.fromisoformat(asof),date(2026,12,31)).isoformat()
def default_asof():return datetime.now(timezone(timedelta(hours=9))).date().isoformat()
def current_observation(asof,instant):
    return asof==quarter_cutoff(instant.astimezone(timezone(timedelta(hours=9))).date().isoformat())
def read(path):return json.loads(Path(path).read_text())
def write(path,data):Path(path).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def periods(start,end):
    a,b=date.fromisoformat(start),date.fromisoformat(end)
    if a>b:return []
    sun=a+timedelta(days=(6-a.weekday())%7);result=[]
    while sun<b:result.append((start,sun.isoformat()));sun+=timedelta(days=7)
    result.append((start,end));return result
def ratio(n,d):return None if n is None or d is None or d<=0 else n/d
def normalize(row,key):
    if int(row['matched_row_count'])==0 or int(row.get('null_'+key+'_rows',0)):return None
    if key in ['cv','clicks'] and int(row.get('invalid_raw_rows',0)):return None
    return row.get(key)
def same_metadata(a,b):return all(a.get(k)==b.get(k) for k in ['id','title','owner','releaseDate'])
def parse_db_time(value):
    stamp=value.replace(' ','T')
    if stamp[-3:] in ['+00','+09']:stamp+=':00'
    stamp=re.sub(r'\.(\d+)(?=[+-])',lambda m:'.'+m[1].ljust(6,'0'),stamp)
    return datetime.fromisoformat(stamp)
def summarize(rows):
    cvrs=[ratio(a['metrics']['cv'],a['metrics']['clicks'])*100 for a in rows
      if not any(w in a['title'] for w in ['貸し','修正']) and ratio(a['metrics']['cv'],a['metrics']['clicks']) is not None]
    return (sum(cvrs)/len(cvrs) if cvrs else None,len(cvrs))
def population(before):
    baseline=read(ROOT/'data/baseline.json')
    old=read(ROOT/'data-import/20261009-revision-meta-articles.json')['articles']
    extra=read(ROOT/'data-import/20261009-revision-september-augmented-reference.json')['addedArticles']
    members=[a for a in baseline['articles'] if a['releaseDate'].startswith('2026-09')]+extra
    for a in members:
        parts=a['title'].split('_')
        a['projectName']=parts[1];a['articleNo']=int(parts[0].replace('★',''))
    live={a['id']:a for a in before['state']['articles']}
    for a in old:
        if a['id'] not in live or not same_metadata(a,live[a['id']]):raise ValueError('承認済み記事metadata不一致: '+a['id'])
    current=[];keys=set()
    for a in live.values():
        if any(term in a['title'] for term in ['貸し','修正']):continue
        if not '2026-10-01'<=a['releaseDate']<='2026-12-31':continue
        match=re.fullmatch(r'★([0-9]{1,3})_([^_]+)_.+_([0-9]{8})',a['title'])
        if not match or match[3]!=a['releaseDate'].replace('-','') or a['owner'] not in PEOPLE+['ai']:raise ValueError('正式記事metadata不正: '+a['id'])
        key=(match[2],int(match[1]))
        if key in keys:raise ValueError('案件×記事番号が複数登録: '+str(key))
        keys.add(key)
        current.append({**{k:a[k] for k in ['id','title','owner','releaseDate']},'projectName':match[2],'articleNo':int(match[1])})
    return members+current
def quote(s):return "'"+str(s).replace("'","''")+"'"
def make_sql(targets,asof):
    periodlist=[('september',a,b) for a,b in periods('2026-09-01','2026-09-30')]+[('quarter',a,b) for a,b in periods('2026-10-01',asof)]+[('detail','2026-10-01',asof)]
    vals=','.join('('+','.join([quote(a['id']),quote(a['projectName']),str(a['articleNo']),"DATE "+quote(a['releaseDate'])])+')' for a in targets)
    pvals=','.join('('+','.join([quote(k),"DATE "+quote(a),"DATE "+quote(b)])+')' for k,a,b in periodlist)
    agg=',\n'.join("SUM(x."+f+") FILTER (WHERE CARDINALITY(x.numbers)=1) AS "+f+", COUNT(x.date) FILTER (WHERE CARDINALITY(x.numbers)=1 AND x."+f+" IS NULL) AS null_"+f+"_rows" for f in FIELDS)
    return f"""WITH target(id,project_name,article_no,release_date) AS (VALUES {vals}),
period(kind,start_date,end_date) AS (VALUES {pvals}),
article_rows AS (
SELECT p.kind,p.start_date::text,p.end_date::text,t.id,
COUNT(x.date) FILTER (WHERE CARDINALITY(x.numbers)=1) AS matched_row_count,
{agg},
COUNT(x.date) FILTER (WHERE CARDINALITY(x.numbers)>1) AS ambiguous_row_count,
ARRAY_AGG(DISTINCT ARRAY_TO_STRING(x.numbers,',')) FILTER (WHERE CARDINALITY(x.numbers)>1) AS ambiguous_number_sets,
COUNT(x.date) FILTER (WHERE CARDINALITY(x.numbers)=1 AND (x.cv<0 OR x.clicks<0 OR x.cv>x.clicks)) AS invalid_raw_rows
FROM target t JOIN period p ON t.release_date>=p.start_date AND t.release_date<=p.end_date
LEFT JOIN LATERAL (SELECT date,{','.join(FIELDS)},
ARRAY(SELECT DISTINCT m[1]::integer FROM regexp_matches(campaign_name,'(?:記事|LP)[[:space:]_-]*([0-9]+)','g') AS m ORDER BY m[1]::integer) AS numbers
FROM campaigns WHERE project_name=t.project_name AND media='META'
AND date>=t.release_date AND date<=p.end_date) x ON t.article_no=ANY(x.numbers)
GROUP BY p.kind,p.start_date,p.end_date,t.id ORDER BY p.kind,p.end_date,t.id),
revenue_rows AS (
SELECT TO_CHAR(date,'YYYY-MM') AS month,date::text,team,GROUPING(date,team) AS grouping_key,COUNT(*) AS row_count,
SUM(revenue) AS revenue,COUNT(*) FILTER (WHERE revenue IS NULL) AS null_revenue_rows
FROM campaigns WHERE date>=DATE '2026-10-01' AND date<=DATE {quote(asof)}
AND team IN ('TM1-1','TM1-2','TM1-3','TM2-1','TM2-2')
GROUP BY GROUPING SETS ((TO_CHAR(date,'YYYY-MM'),date,team),(TO_CHAR(date,'YYYY-MM'),date),(TO_CHAR(date,'YYYY-MM'),team),(TO_CHAR(date,'YYYY-MM'))) ORDER BY month,grouping_key,date,team)
SELECT JSONB_BUILD_OBJECT('retrievedAt',CURRENT_TIMESTAMP::text,
'articleRows',(SELECT JSONB_AGG(TO_JSONB(a)) FROM article_rows a),
'revenueRows',(SELECT JSONB_AGG(TO_JSONB(r)) FROM revenue_rows r)) AS payload;"""
def extract(response):
    if response.get('isError'):raise ValueError('MCP query error')
    values=json.loads(next(x['text'] for x in response['content'] if x['type']=='text'))
    return values[0]['payload']
def build(response,before,targets,asof,prefix):
    raw=extract(response);mapped={a['id']:a for a in targets};rows=raw['articleRows'];seen=set()
    for r in rows:
        key=(r['kind'],r['end_date'],r['id'])
        if key in seen:raise ValueError('duplicate row')
        seen.add(key)
    instant=parse_db_time(raw['retrievedAt'])
    if not current_observation(asof,instant):raise ValueError('候補更新は取得JST日（3Q末で上限）と観測日が一致する取得だけ。過去取得は参照専用')
    fetched=instant.astimezone(timezone(timedelta(hours=9))).isoformat()
    def norm(r):return {**mapped[r['id']],'metrics':{f:normalize(r,f) for f in FIELDS}}
    details=[{**{k:a[k] for k in ['id','title','owner','projectName','articleNo','releaseDate']},'observedThrough':asof,'metrics':a['metrics']} for a in [norm(r) for r in rows if r['kind']=='detail']]
    trend={}
    for kind,start,end in [('september','2026-09-01','2026-09-30'),('quarter','2026-10-01',asof)]:
        points=[]
        for a,b in periods(start,end):
            group=[norm(r) for r in rows if r['kind']==kind and r['end_date']==b]
            expected=[t['id'] for t in targets if a<=t['releaseDate']<=b]
            if set(t['id'] for t in group)!=set(expected):raise ValueError('population mismatch')
            cvr,count=summarize(group)
            points.append({'releaseStart':a,'releaseEnd':b,'observedThrough':b,'teamCvr':cvr,'eligibleArticles':count,
              'people':{p:cvr if p=='usukura' else summarize([g for g in group if g['owner']==p])[0] for p in PEOPLE}})
        trend[kind]=points
    revenue_rows=raw['revenueRows']
    if any('month' not in r for r in revenue_rows):
        # 2026/10/9の旧同期SQLは10月だけ。既保存原数を再利用する互換経路。
        if asof>'2026-10-31':raise ValueError('複数月の旧原数形式は不可')
        for r in revenue_rows:r['month']='2026-10'
    actuals={}
    for month in ['2026-10','2026-11','2026-12']:
        month_rows=[r for r in revenue_rows if r['month']==month]
        revenue=next((r for r in month_rows if r['grouping_key']==3),None)
        if revenue:
            for k in [0,1,2]:
                if sum(r['revenue'] or 0 for r in month_rows if r['grouping_key']==k)!=(revenue['revenue'] or 0):raise ValueError('revenue aggregation mismatch')
        actuals[month]=None if not revenue or revenue['row_count']==0 or revenue['null_revenue_rows'] else revenue['revenue']
    public={'schemaVersion':1,'asOf':asof,'fetchedAtJst':fetched,'media':'META','populationComplete':False,'articles':details,
      'trend':{'basis':'article_mean',**trend},'notes':['登録記事を対象に集計。9月には実リリース・担当範囲が未確認の6候補があり、網羅性は未確定。',
      '9月は9/1以降、3Qは10/1以降リリース記事を各週まで累計。原数はリリース日〜各週の観測終端。最新日は当日途中。',
      '9月の累計推移は9/25確認3記事を加えた22記事。固定比較値の9月1.65%・2Q2.22%は従来73記事の対象を保持している。']}
    write(ROOT/'public/axad-data.json',public)
    state=copy.deepcopy(before['state']);latest=max(state['weeks'],key=lambda w:w['id'])['id']
    for a in state['articles']:
        d=next((d for d in details if d['id']==a['id']),None)
        if d:
            if not same_metadata(a,d):raise ValueError('state metadata mismatch')
            a.update(metaCv=d['metrics']['cv'],metaClicks=d['metrics']['clicks'],observedThrough=asof)
    for m in state['monthlyRevenue']:
        if m['month']+'-01'<=asof:
            year,num=map(int,m['month'].split('-'));last=(date(year+1,1,1) if num==12 else date(year,num+1,1))-timedelta(days=1)
            m.update(actual=actuals[m['month']],asOf=min(asof,last.isoformat()))
    write(str(prefix)+'candidate-before-metrics.json',state)
    utc=instant.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    js="""import fs from 'node:fs';import {calculateMetrics} from './public/model.js';
const args=process.argv.slice(1);const s=JSON.parse(fs.readFileSync(args[0],'utf8'));const w=s.weeks.find(w=>w.id===args[2]);
w.metrics=calculateMetrics(s,w,args[3]);w.metrics.monthlyRevenue=structuredClone(s.monthlyRevenue);s.updatedAt=args[3];fs.writeFileSync(args[1],JSON.stringify(s,null,2)+'\\n');"""
    subprocess.run(['node','--input-type=module','-e',js,str(prefix)+'candidate-before-metrics.json',str(prefix)+'candidate-state.json',latest,utc],cwd=ROOT,check=True)
    candidate=read(str(prefix)+'candidate-state.json');changes=diff(before['state'],candidate)
    target_ids={d['id'] for d in details}
    validate_changes(changes, before['state'],latest,asof,target_ids)
    write(str(prefix)+'candidate-review.json',{'revision':before['revision'],'asOf':asof,'retrievedAt':utc,'revenue':actuals,'targetArticleIds':sorted(target_ids),'changes':changes,
      'validation':{'allowedPathsOnly':True,'detailsCount':len(details),'septemberPopulation':sum(t['releaseDate'].startswith('2026-09') for t in targets),
        'revenueAggregations':3,'ambiguousRows':sum(r['ambiguous_row_count'] for r in rows),'nullCvRows':sum(r['null_cv_rows'] for r in rows),
        'nullClicksRows':sum(r['null_clicks_rows'] for r in rows),'invalidRawRows':sum(r['invalid_raw_rows'] for r in rows),
        'baselinePreserved':candidate['baseline']==before['state']['baseline'],'initiativesPreserved':candidate['initiatives']==before['state']['initiatives'],
        'previousWeeksPreserved':all(w==next(c for c in candidate['weeks'] if c['id']==w['id']) for w in before['state']['weeks'] if w['id']!=latest)}})
    print(json.dumps({'details':len(details),'september':trend['september'],'quarter':trend['quarter'],'revenue':actuals,'fetchedAtJst':fetched},ensure_ascii=False))
def diff(a,b,path=''):
    if type(a)!=type(b):return [{'path':path,'before':a,'after':b}]
    if isinstance(a,dict):
        if set(a)!=set(b):return [{'path':path,'before':a,'after':b}]
        return [d for k in a for d in diff(a[k],b[k],path+'/'+k)]
    if isinstance(a,list):
        if len(a)!=len(b):return [{'path':path,'before':a,'after':b}]
        return [d for i,(x,y) in enumerate(zip(a,b)) for d in diff(x,y,path+'/'+str(i))]
    return [] if a==b else [{'path':path,'before':a,'after':b}]
def validate_changes(changes,before,latest,asof='2026-10-09',target_ids=None):
    import re
    latest_index=next(i for i,w in enumerate(before['weeks']) if w['id']==latest)
    month_indices={i for i,m in enumerate(before['monthlyRevenue']) if '2026-10'<=m['month']<='2026-12' and m['month']+'-01'<=asof}
    article_indices={i for i,a in enumerate(before.get('articles',[])) if target_ids is None or a['id'] in target_ids}
    for d in changes:
        p=d['path']
        article_match=re.fullmatch(r'/articles/(\d+)/(metaCv|metaClicks|observedThrough)',p)
        allowed=(p=='/updatedAt' or bool(article_match and int(article_match[1]) in article_indices) or
            p.startswith('/weeks/'+str(latest_index)+'/metrics/') or
            any(p in ['/monthlyRevenue/'+str(i)+'/actual','/monthlyRevenue/'+str(i)+'/asOf'] for i in month_indices))
        if not allowed:raise ValueError('許可外差分: '+p)
def api_get():return json.load(urllib.request.urlopen(API,timeout=30))
def apply_candidate(prefix):
    before=read(str(prefix)+'before-api.json');candidate=read(str(prefix)+'candidate-state.json')
    latest=max(before['state']['weeks'],key=lambda w:w['id'])['id']
    review=read(str(prefix)+'candidate-review.json')
    validate_changes(diff(before['state'],candidate),before['state'],latest,review['asOf'],set(review['targetArticleIds']))
    envpath=Path(str(prefix)+'apply-envelope.json')
    envelope={'state':candidate,'revision':before['revision'],'requestId':str(uuid.uuid4()),'editor':'AXAD週次更新'}
    if envpath.exists():
        old=read(envpath)
        if old['state']!=candidate or old['revision']!=before['revision']:raise ValueError('保存IDの内容変更は禁止')
        envelope=old
    else:write(envpath,envelope)
    fresh=api_get()
    def ignore_updated(s):t=copy.deepcopy(s);t.pop('updatedAt',None);return t
    attempted=Path(str(prefix)+'apply-attempted.json')
    if fresh['revision']!=before['revision']:
        if not attempted.exists() or ignore_updated(fresh['state'])!=ignore_updated(candidate):raise ValueError('409相当: revision変更。GETから候補を再作成してください')
    elif fresh['state']!=before['state']:raise ValueError('同revision状態不一致')
    write(attempted,{'requestId':envelope['requestId'],'payloadSha256':hashlib.sha256(json.dumps(envelope,sort_keys=True).encode()).hexdigest()})
    request=urllib.request.Request(API,data=json.dumps(envelope).encode(),headers={'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(request,timeout=45) as response:result=json.load(response)
    write(str(prefix)+'apply-result.json',result)
    if ignore_updated(result['state'])!=ignore_updated(candidate):raise ValueError('保存読戻し候補不一致')
    print(json.dumps({'revision':result['revision'],'commitUrl':result.get('commitUrl'),'updatedAt':result['state']['updatedAt'],'deduplicated':result.get('deduplicated',False)}))
def main():
    p=argparse.ArgumentParser();p.add_argument('--as-of',default=default_asof());p.add_argument('--prefix',required=True)
    p.add_argument('--sql',action='store_true');p.add_argument('--response');p.add_argument('--apply',action='store_true');p.add_argument('--read-before',action='store_true')
    a=p.parse_args();a.as_of=quarter_cutoff(a.as_of);prefix=Path(a.prefix)
    if a.read_before:write(str(prefix)+'before-api.json',api_get());return
    if a.apply:apply_candidate(prefix);return
    before=read(str(prefix)+'before-api.json');targets=population(before)
    write(str(prefix)+'population.json',targets)
    sql=make_sql(targets,a.as_of);Path(str(prefix)+'queries.sql').write_text(sql+'\n')
    if a.sql:print(sql);return
    if not a.response:raise ValueError('--sql又は--response必須。既定は保存せず候補作成')
    build(read(a.response),before,targets,a.as_of,prefix)
if __name__=='__main__':main()
