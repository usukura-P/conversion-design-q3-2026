import test from 'node:test';
import assert from 'node:assert/strict';
import {preserveLegacyArticleReviews} from './state-compat.mjs';

test('legacy reviews are matched by week ID without changing requests or aliasing stored data',()=>{
 const review={id:'article-1',rating:'good',result:'原文',analysis:'分析',next:'次'};
 const stored={weeks:[{id:'2026-10-05',articleReviews:[review]},{id:'2026-10-12',articleReviews:[]}]};
 const incoming={weeks:[{id:'2026-10-12'},{id:'2026-10-05'},{id:'2026-10-19'}]};
 const result=preserveLegacyArticleReviews(incoming,stored);
 assert.deepEqual(result.weeks[0].articleReviews,[]);
 assert.deepEqual(result.weeks[1].articleReviews,[review]);
 assert.equal(Object.hasOwn(result.weeks[2],'articleReviews'),false);
 assert.equal(Object.hasOwn(incoming.weeks[1],'articleReviews'),false);
 result.weeks[1].articleReviews[0].result='更新';
 assert.equal(stored.weeks[0].articleReviews[0].result,'原文');
});

test('explicit updates and empty arrays take precedence over stored reviews',()=>{
 const stored={weeks:[{id:'2026-10-05',articleReviews:[{id:'article-1'}]},{id:'2026-10-12',articleReviews:[{id:'article-2'}]}]};
 const incoming={weeks:[{id:'2026-10-05',articleReviews:[]},{id:'2026-10-12',articleReviews:[{id:'article-3'}]}]};
 assert.deepEqual(preserveLegacyArticleReviews(incoming,stored),incoming);
});
