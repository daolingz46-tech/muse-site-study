import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyTraffic,campaignLabel} from '../src/lib/traffic.ts';
test('来源按域名边界分类，微信环境不冒充推荐来源',()=>{
 assert.equal(classifyTraffic({referrer:'https://google.com.evil.test/a'}).channel,'external');
 assert.equal(classifyTraffic({referrer:'https://gemini.google.com/app'}).platform,'Gemini');
 assert.equal(classifyTraffic({wechat:true}).channel,'unknown');
 assert.equal(classifyTraffic({referrer:'https://musetoken.store/?token=secret'}).host,'');
 assert.equal(classifyTraffic({referrer:'https://chatgpt.com/'}).channel,'ai');
});
test('推广标记优先，来源不保留路径凭据或敏感参数',()=>{
 const r=classifyTraffic({utmSource:'XHS',utmCampaign:'poster_01',referrer:'https://google.com/?q=secret',page:'/admin/private'});
 assert.equal(r.platform,'xhs');assert.equal(r.evidence,'tag');assert.equal(r.host,'google.com');assert.equal(r.page,'/');
 assert.equal(campaignLabel('buyer@example.com'),'');assert.equal(campaignLabel('https://example.com'), '');
 assert.equal(classifyTraffic({referrer:'https://user:pass@example.com/'}).host,'');
 assert.equal(campaignLabel('海报01'),'海报01');
});
