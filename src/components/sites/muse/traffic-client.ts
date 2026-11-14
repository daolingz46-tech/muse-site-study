import {campaignLabel,trafficId} from "../../../lib/traffic";
import {storeApiUrl} from "./store-api";
type Session={id:string;seen:number;entry:string;payload:Record<string,unknown>};
let current:Session|null=null;
let pending:Promise<unknown>=Promise.resolve();
let lastProduct="muse";
function session():Session {
  const now=Date.now();

  const params=new URLSearchParams(location.search);
  const entry=["utm_source","utm_medium","utm_campaign","utm_content","ref"].map(k=>campaignLabel(params.get(k))).join("|");
  try {const old=JSON.parse(sessionStorage.getItem("muse-traffic-v1")||"null") as Session|null;if(old && typeof old.id==="string" && trafficId.test(old.id) && old.payload && now-old.seen<1800000 && old.entry===entry)current=old;}catch{/* Storage is optional. */}
  if(!current || now-current.seen>=1800000 || current.entry!==entry){
    const ua=navigator.userAgent.toLowerCase();
    let referrer=""; try {referrer=new URL(document.referrer).origin;}catch{/* No source provided. */}
    current={id:crypto.randomUUID(),seen:now,entry,payload:{referrer,page:/^\/(?:muse|gpt|gmail|mail|token)?\/?$/.test(location.pathname)?location.pathname:"/",utmSource:campaignLabel(params.get("utm_source")),utmMedium:campaignLabel(params.get("utm_medium")),utmCampaign:campaignLabel(params.get("utm_campaign")),utmContent:campaignLabel(params.get("utm_content")),referralCode:/^[a-f0-9]{32}$/.test(params.get("ref")||"")?params.get("ref"):"",device:/ipad|tablet/.test(ua)?"tablet":/mobile|android|iphone/.test(ua)?"mobile":"desktop",wechat:/micromessenger/.test(ua)}};
  }
  current.seen=now;
  try {sessionStorage.setItem("muse-traffic-v1",JSON.stringify(current));}catch{/* Continue without persistent storage. */}
  return current;
}
export function trackProduct(product:string) {
  lastProduct=product;
  if(typeof window==="undefined" || location.hostname!=="musetoken.store")return;
  try {const s=session();pending=fetch(storeApiUrl("/api/traffic"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...s.payload,id:s.id,product}),keepalive:true,signal:AbortSignal.timeout(3000)}).catch(()=>{});}catch{/* Analytics must never block shopping. */}
}
export async function currentTrafficId() {
  trackProduct(lastProduct);
  await pending;
  return current?.id;
}
