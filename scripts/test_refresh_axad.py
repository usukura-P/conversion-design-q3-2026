import unittest
import copy,io,json,tempfile
from pathlib import Path
from unittest.mock import patch
from refresh_axad import periods, ratio, normalize, same_metadata, summarize, parse_db_time, diff, validate_changes, quarter_cutoff,make_sql
class BoundaryTests(unittest.TestCase):
    def test_sunday_and_monday(self):
        self.assertEqual([x[1] for x in periods('2026-10-01','2026-10-04')],['2026-10-04'])
        self.assertEqual([x[1] for x in periods('2026-10-01','2026-10-05')],['2026-10-04','2026-10-05'])
    def test_september_end(self):
        self.assertEqual([x[1] for x in periods('2026-09-01','2026-09-30')],['2026-09-06','2026-09-13','2026-09-20','2026-09-27','2026-09-30'])
    def test_quarter_reset_and_future(self):
        self.assertEqual(periods('2026-10-01','2026-09-30'),[])
        self.assertTrue(all(a=='2026-10-01' and b<='2026-10-09' for a,b in periods('2026-10-01','2026-10-09')))
    def test_zero_null(self):
        self.assertIsNone(ratio(1,0));self.assertIsNone(ratio(None,1));self.assertEqual(ratio(0,2),0)
        self.assertIsNone(normalize({'matched_row_count':0,'null_cv_rows':0,'cv':None},'cv'))
        self.assertIsNone(normalize({'matched_row_count':3,'null_cv_rows':1,'cv':7},'cv'))
        self.assertEqual(normalize({'matched_row_count':3,'null_cv_rows':0,'cv':0},'cv'),0)
    def test_negative_profit_valid(self):
        self.assertEqual(normalize({'matched_row_count':1,'null_profit_rows':0,'profit':-5},'profit'),-5)
    def test_invalid_cv_null(self):
        self.assertIsNone(normalize({'matched_row_count':1,'null_cv_rows':0,'invalid_raw_rows':1,'cv':7},'cv'))
    def test_metadata_mismatch(self):
        a={'id':'x','title':'article','owner':'ai','releaseDate':'2026-09-01'}
        self.assertTrue(same_metadata(a,dict(a)))
        self.assertFalse(same_metadata(a,{**a,'title':'changed'}))
    def test_mean_with_ai_and_exclusion(self):
        rows=[{'title':'a','owner':'ai','metrics':{'cv':1,'clicks':2}}, {'title':'改修','owner':'aoki','metrics':{'cv':0,'clicks':10}}, {'title':'修正','owner':'aoki','metrics':{'cv':8,'clicks':10}}]
        self.assertEqual(summarize(rows),(25.0,2))
        self.assertEqual(summarize([]),(None,0))
    def test_ambiguity_sum_null(self):
        self.assertIsNone(normalize({'matched_row_count':0,'ambiguous_row_count':3,'null_cv_rows':0,'cv':None},'cv'))
    def test_timestamp_variable_precision(self):
        self.assertEqual(parse_db_time('2026-10-09 06:59:45.29777+00').microsecond,297770)
        from refresh_axad import current_observation
        instant=parse_db_time('2026-10-09 06:59:45.29777+00')
        self.assertTrue(current_observation('2026-10-09',instant))
        self.assertFalse(current_observation('2026-10-04',instant))
    def test_future_release_excluded_sql(self):
        from refresh_axad import make_sql
        sql=make_sql([{'id':'future','projectName':'x','articleNo':1,'releaseDate':'2026-10-10'}],'2026-10-09')
        self.assertIn('t.release_date<=p.end_date',sql)
        self.assertIn('date<=p.end_date',sql)
    def test_only_expected_paths(self):
        before={'articles':[{'id':'x'}],'monthlyRevenue':[{'month':'2026-10'},{'month':'2026-11'}],'weeks':[{'id':'2026-10-05'},{'id':'2026-10-12'}]}
        good=[{'path':p} for p in ['/updatedAt','/articles/0/metaCv','/monthlyRevenue/0/actual','/weeks/1/metrics/teamCvr']]
        validate_changes(good,before,'2026-10-12')
        for p in ['/baseline/septemberCvr','/articles/0/title','/weeks/1/team/status','/weeks/0/metrics/teamCvr','/monthlyRevenue/1/actual','/initiatives/0/id']:
            with self.assertRaises(ValueError):validate_changes([{'path':p}],before,'2026-10-12')
    def test_diff_detects_deleted_fields(self):
        self.assertEqual(diff({'x':1},{})[0]['path'],'')
    def test_october_november_boundary_and_target_guard(self):
        before={'articles':[{'id':'x'},{'id':'unimported'}],'monthlyRevenue':[{'month':'2026-10'},{'month':'2026-11'},{'month':'2026-12'}],'weeks':[{'id':'2026-10-12'}]}
        with self.assertRaises(ValueError):validate_changes([{'path':'/monthlyRevenue/1/actual'}],before,'2026-10-12','2026-10-31',{'x'})
        validate_changes([{'path':'/monthlyRevenue/1/actual'}],before,'2026-10-12','2026-11-01',{'x'})
        with self.assertRaises(ValueError):validate_changes([{'path':'/monthlyRevenue/2/actual'}],before,'2026-10-12','2026-11-01',{'x'})
        with self.assertRaises(ValueError):validate_changes([{'path':'/articles/1/metaCv'}],before,'2026-10-12','2026-11-01',{'x'})
        self.assertEqual(quarter_cutoff('2027-01-04'),'2026-12-31')
        sql=make_sql([{'id':'x','projectName':'p','articleNo':1,'releaseDate':'2026-10-01'}],'2026-11-01')
        self.assertIn("TO_CHAR(date,'YYYY-MM') AS month",sql)
        self.assertIn("(TO_CHAR(date,'YYYY-MM'),date,team)",sql)
class ApplyTests(unittest.TestCase):
    def test_conflict_write_nothing_and_idempotent_replay(self):
        import refresh_axad as module
        state={'updatedAt':None,'articles':[{'id':'x','metaClicks':1}],'monthlyRevenue':[{'month':'2026-10','actual':None}],'weeks':[{'id':'2026-10-12','metrics':{}}]}
        candidate=copy.deepcopy(state);candidate['articles'][0]['metaClicks']=2
        with tempfile.TemporaryDirectory(dir=module.ROOT/'data-import') as tmp:
            prefix=Path(tmp)/'case-'
            module.write(str(prefix)+'before-api.json',{'state':state,'revision':'a'*40})
            module.write(str(prefix)+'candidate-state.json',candidate)
            module.write(str(prefix)+'candidate-review.json',{'asOf':'2026-10-09','targetArticleIds':['x']})
            with patch.object(module,'api_get',return_value={'state':state,'revision':'b'*40}),patch.object(module.urllib.request,'urlopen') as post:
                with self.assertRaisesRegex(ValueError,'revision変更'):module.apply_candidate(prefix)
                post.assert_not_called()
            fresh={'state':state,'revision':'a'*40};sent=[]
            def fake_post(request,**kwargs):
                sent.append(json.loads(request.data));saved=copy.deepcopy(candidate);saved['updatedAt']='server-time'
                fresh.update(state=saved,revision='b'*40)
                return io.BytesIO(json.dumps({'state':saved,'revision':'b'*40,'deduplicated':len(sent)>1}).encode())
            with patch.object(module,'api_get',side_effect=lambda:copy.deepcopy(fresh)),patch.object(module.urllib.request,'urlopen',side_effect=fake_post):
                module.apply_candidate(prefix);module.apply_candidate(prefix)
                self.assertEqual(sent[0],sent[1])
                candidate['articles'][0]['metaClicks']=3;module.write(str(prefix)+'candidate-state.json',candidate)
                with self.assertRaisesRegex(ValueError,'保存IDの内容変更'):module.apply_candidate(prefix)
                self.assertEqual(len(sent),2)
if __name__=='__main__':unittest.main()
