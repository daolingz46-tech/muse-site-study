import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
const base='https://musetoken.store';
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}});const visits=[];let checkout;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==base)return route.abort();
   if(!u.pathname.startsWith('/api/'))return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:18941'+u.pathname+u.search})});
   if(u.pathname==='/api/traffic'){visits.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});}
   if(u.pathname==='/api/orders'){checkout=route.request().postDataJSON();return route.fulfill({status:409,json:{message:'模拟测试，不创建真实订单'}});}
   const k=u.pathname.split('/').at(-1);const values={traffic:{rows:[{channel:'campaign',platform:'wechat',medium:'social',campaign:'poster_01',content:'a',agentName:'',visits:10,productVisits:10,orders:3,paidOrders:2,convertedVisits:1,revenueCents:3600}],recent:[],unattributedOrders:2},orders:{orders:[],count:{total:0},summary:{total:0,awaiting:0,processing:0,completed:0,revenueCents:0,todayCents:0}},catalog:{products:[]},visits:{summary:{total:0,today:0,last7Days:0},recent:[]},'custom-products':{items:[]},custom:{items:[]},sales:{counts:{}},availability:{stock:{}},tutorial:{title:'教程',blocks:[]},inventory:{available:0,basicAvailable:0,gpt:[]},'email-status':{configured:true}};
   return route.fulfill({json:values[k]||{ok:true}});
  });
  await page.goto(base+'/?utm_source=wechat&utm_medium=social&utm_campaign=poster_01');
  await expect.poll(()=>visits.length).toBeGreaterThan(0);expect(visits[0].utmSource).toBe('wechat');const id=visits[0].id;
  await page.reload();await expect.poll(()=>visits.length).toBeGreaterThan(1);expect(visits.at(-1).id).toBe(id);
  await page.getByLabel('收件邮箱').fill('mock@example.com');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'确认订单'}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'继续下单'}).click();await expect.poll(()=>checkout?.trafficId).toBe(id);
  await page.goto(base+'/admin/');await expect(page.getByRole('heading',{name:'访客来源与成交'})).toBeVisible();await expect(page.getByText('10.0%',{exact:true})).toBeVisible();
  await page.getByText('生成推广链接和二维码',{exact:true}).click();await page.getByLabel('活动名称',{exact:true}).fill('poster_02');await page.getByRole('button',{name:'生成链接和二维码',exact:true}).click();await expect(page.getByAltText('推广链接二维码，点击保存')).toBeVisible();expect(await page.getByAltText('推广链接二维码，点击保存').getAttribute('src')).toMatch(/^data:image\/png/);expect(errors).toEqual([]);await page.close();
 }
 console.log('PASS mobile/desktop: attribution, reload deduplication, checkout association, report conversion and QR generation; all requests mocked');
}finally{await browser.close();}
