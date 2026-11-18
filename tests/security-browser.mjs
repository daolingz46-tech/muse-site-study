import {chromium,expect} from '@playwright/test';
const base=process.env.TEST_BASE_URL||'http://localhost:8793';
if(!/^http:\/\/(localhost|127\.0\.0\.1):/.test(base))throw Error('Mock tests require localhost');
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
await context.addInitScript(()=>{window.cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.cspViolations.push(e.violatedDirective+':'+e.blockedURI));});
let login=false,order;
await context.route('**/api/**',async route=>{
 const p=new URL(route.request().url()).pathname;let data={};let status=200;
 if(p==='/api/test-qr') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280"><rect width="280" height="280" fill="white"/></svg>'});
 if(p==='/api/orders'){const input=route.request().postDataJSON();order={id:'mock-seo-order',token:'mock-test-only',code:'0123',product:'muse',title:'Muse AI 测试订单',amountCents:1800,feeCents:0,method:input.method,email:'buyer@example.com',status:'pending',expiresAt:Date.now()+900000,createdAt:Date.now(),qrImageUrl:'/api/test-qr'};data=order;}
 else if(p==='/api/orders/lookup')data=order;
 else if(p==='/api/admin/login'){login=true;data={ok:true};}
 else if(p==='/api/admin/orders'){if(!login){status=401;data={message:'请登录'};}else data={orders:[],count:{total:0},page:0,summary:{total:0,awaiting:0,processing:0,completed:0,revenueCents:0,todayCents:0}};}
 else if(p==='/api/admin/visits')data={summary:{total:0,today:0,last7Days:0},recent:[]};
 else if(p==='/api/admin/catalog')data={products:[]};
 else if(p==='/api/admin/inventory')data={groups:[]};
 else if(p==='/api/admin/tutorial')data={title:'测试',blocks:[]};
 else if(p==='/api/catalog/custom')data={items:[]};
 else if(p==='/api/catalog/sales')data={counts:{}};
 else if(p==='/api/availability')data={stock:{}};
 else if(p.startsWith('/api/admin/')){status=503;data={message:'Mock endpoint unavailable'};}
 await route.fulfill({status,json:data});
});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.stack));
for(const method of ['alipay','wechat']){
 await page.goto(base+'/account/');await page.locator('#muse-email').fill('buyer@example.com');await page.locator('#muse-payment-method').selectOption(method);await page.locator('.muse-agreement input').check();await page.getByRole('button',{name:'确认订单'}).click();await page.getByRole('checkbox',{name:'我已阅读并同意以上购买须知'}).check();await page.getByRole('button',{name:'继续下单',exact:true}).click({timeout:15000});await expect(page.getByRole('heading',{name:'支付订单'})).toBeVisible();await page.getByRole('button',{name:'复制订单码',exact:true}).click();await page.locator('.muse-remark-agree input').check();await page.getByRole('button',{name:/第 2 步/}).click();await expect(page.locator('.muse-collection-image')).toBeVisible();await expect.poll(()=>page.locator('.muse-collection-image').evaluate(i=>i.naturalWidth)).toBeGreaterThan(0);expect(await page.locator('meta[name=robots]').getAttribute('content')).toContain('noindex');expect(await page.evaluate(()=>window.cspViolations)).toEqual([]);
}
await page.goto(base+'/admin/');await expect(page.locator('input[type=password]')).toBeVisible();await page.locator('input[type=password]').fill('mock-password');await page.locator('.wb-login button[type=submit],.wb-login button').last().click();await expect(page.locator('.wb-login')).toHaveCount(0);expect(login).toBe(true);expect(await page.evaluate(()=>window.cspViolations)).toEqual([]);expect(errors).toEqual([]);
await browser.close();console.log('PASS CSP: Alipay/WeChat mock checkout, QR loading, noindex and admin login');
