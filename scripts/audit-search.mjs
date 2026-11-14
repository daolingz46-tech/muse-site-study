import fs from 'node:fs';
import {chromium} from '@playwright/test';
const origin=process.env.AUDIT_ORIGIN||'https://musetoken.store';
const browser=await chromium.launch({channel:'msedge',headless:true});
const terms = {'/':['10亿 Token','7 天质保'], '/account/':['10亿 Token','7 天质保'], '/token/':['300亿 Token','邀请码','不包含账号'], '/gpt/':['半价资格','不含 Plus'], '/gmail/':['收件正常','随机'], '/mail/':['邮箱和密码'], '/guides/muse-account/':['首次登录','收件邮箱'], '/guides/muse-token/':['邀请码','充值']};
const results=[];
fs.mkdirSync('output',{recursive:true});
for(const path of ['/','/account/','/token/','/gpt/','/gmail/','/mail/','/guides/muse-account/','/guides/muse-token/']){
 const r=await fetch(origin+path);const html=await r.text();
 const row={path,status:r.status,headers:Object.fromEntries(['strict-transport-security','content-security-policy','x-content-type-options','x-robots-tag'].map(k=>[k,r.headers.get(k)])),rawBytes:html.length};
 for(const js of [false,true]){
 const context=await browser.newContext({javaScriptEnabled:js});const page=await context.newPage();const errors=[];await page.addInitScript(()=>{window.auditCsp=[];document.addEventListener('securitypolicyviolation',e=>window.auditCsp.push(e.violatedDirective));});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+path,{waitUntil:'load'});await page.waitForTimeout(1500);
 row[js?'rendered':'noJS']=await page.evaluate(()=>({title:document.title,description:document.querySelector('meta[name="description"]')?.content,canonical:document.querySelector('link[rel="canonical"]')?.href,h1:[...document.querySelectorAll('h1')].map(x=>x.textContent),text:document.body.innerText,cspViolations:window.auditCsp||[],images:[...document.images].map(i=>({src:new URL(i.src).pathname,alt:i.getAttribute('alt'),width:i.getAttribute('width'),height:i.getAttribute('height'),natural:[i.naturalWidth,i.naturalHeight],display:[i.width,i.height]}))}));row[js?'rendered':'noJS'].errors=errors;await context.close();
 }
 const rawText=html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]*>/g,'');
 row.importantContentReadable=terms[path].every(term=>rawText.includes(term)&&row.noJS.text.includes(term)&&row.rendered.text.includes(term));
 row.metadataConsistent=row.noJS.title===row.rendered.title&&row.noJS.description===row.rendered.description&&row.noJS.canonical===row.rendered.canonical;
 row.renderedChanges={added:row.rendered.text.split('\n').filter(x=>!row.noJS.text.split('\n').includes(x)),removed:row.noJS.text.split('\n').filter(x=>!row.rendered.text.split('\n').includes(x))};
 results.push(row);
}
await browser.close();fs.writeFileSync(process.argv[2]||'output/search-audit.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(r=>({path:r.path,headers:r.headers,importantContentReadable:r.importantContentReadable,metadataConsistent:r.metadataConsistent,h1:r.noJS.h1,noJsChars:r.noJS.text.length,renderedChars:r.rendered.text.length,mainImage:r.rendered.images.find(i=>i.alt),missingDimensions:r.rendered.images.filter(i=>!i.width||!i.height).length,cspViolations:r.rendered.cspViolations,errors:r.rendered.errors})),null,2));

if(results.some(r=>r.status!==200||!r.importantContentReadable||!r.metadataConsistent||r.rendered.errors.length||r.rendered.cspViolations.length))process.exitCode=1;
