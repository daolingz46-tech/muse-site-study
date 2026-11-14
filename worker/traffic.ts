import type {D1Database} from "@cloudflare/workers-types";
import { classifyTraffic, trafficId } from "../src/lib/traffic";

export async function recordTraffic(db:D1Database,input:Record<string,unknown>,now=Date.now()) {
  const id=typeof input.id==="string" ? input.id : "";
  if (!trafficId.test(id)) return false;
  const v=classifyTraffic(input);
  const referral=typeof input.referralCode==="string" && /^[a-f0-9]{32}$/.test(input.referralCode) ? input.referralCode : "";
  const product=["muse","muse-token","gpt","gmail","mail"].includes(String(input.product)) ? String(input.product) : "muse";
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO visits(id,page,source,device,createdAt) VALUES(?,?,?,?,?)").bind(id,v.page,v.channel==="search" ? "search" : v.channel==="social" ? "social" : v.channel==="wechat" ? "wechat" : v.channel==="unknown" ? "direct" : "external",v.device,now),
    db.prepare("INSERT OR IGNORE INTO traffic_visits(id,channel,platform,referrerHost,medium,campaign,content,landingPage,evidence,device,wechat,agentId,createdAt,lastSeenAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,(SELECT id FROM agents WHERE referralCode=? AND status='active'),?,?)").bind(id,v.channel,v.platform,v.host,v.medium,v.campaign,v.content,v.page,v.evidence,v.device,v.wechat,referral,now,now),
    db.prepare("UPDATE traffic_visits SET lastSeenAt=? WHERE id=? AND createdAt>=?").bind(now,id,now-86400000),
    db.prepare("INSERT OR IGNORE INTO traffic_views(visitId,product) SELECT id,? FROM traffic_visits WHERE id=? AND createdAt>=?").bind(product,id,now-86400000),
  ]);
  return true;
}
export function trafficOrderStatement(db:D1Database,id:string,requestHash:string,input:unknown,now:number) {
  const visitId=typeof input==="string" && trafficId.test(input) ? input : "";
  return db.prepare("INSERT OR IGNORE INTO traffic_orders(orderId,visitId) SELECT o.id,v.id FROM orders o JOIN traffic_visits v ON v.id=? WHERE o.id=? AND o.requestHash=? AND v.lastSeenAt>=? AND v.createdAt>=?").bind(visitId,id,requestHash,now-1800000,now-86400000);
}
export async function trafficReport(db:D1Database,days:number,now=Date.now()) {
  const since=now-days*86400000;
  const query=`SELECT v.channel,v.platform,v.medium,v.campaign,v.content,COALESCE(g.name,'') AS agentName,COUNT(*) AS visits,SUM(x.viewed) AS productVisits,SUM(x.orders) AS orders,SUM(x.paid) AS paidOrders,SUM(x.converted) AS convertedVisits,SUM(x.revenue) AS revenueCents FROM traffic_visits v LEFT JOIN agents g ON g.id=v.agentId JOIN (SELECT a.id,EXISTS(SELECT 1 FROM traffic_views WHERE visitId=a.id) AS viewed,(SELECT COUNT(*) FROM traffic_orders WHERE visitId=a.id) AS orders,(SELECT COUNT(*) FROM traffic_orders t JOIN orders o ON o.id=t.orderId WHERE t.visitId=a.id AND o.paidAt IS NOT NULL AND o.status IN ('processing','complete')) AS paid,EXISTS(SELECT 1 FROM traffic_orders t JOIN orders o ON o.id=t.orderId WHERE t.visitId=a.id AND o.paidAt IS NOT NULL AND o.status IN ('processing','complete')) AS converted,(SELECT COALESCE(SUM(o.amountCents),0) FROM traffic_orders t JOIN orders o ON o.id=t.orderId WHERE t.visitId=a.id AND o.paidAt IS NOT NULL AND o.status IN ('processing','complete')) AS revenue FROM traffic_visits a WHERE a.createdAt>=?) x ON x.id=v.id GROUP BY v.channel,v.platform,v.medium,v.campaign,v.content,v.agentId ORDER BY visits DESC LIMIT 200`;
  const rows=await db.prepare(query).bind(since).all();
  const recent=await db.prepare("SELECT v.platform,v.channel,v.referrerHost,v.landingPage,v.evidence,v.device,v.wechat,v.createdAt,v.campaign,v.content,g.name AS agentName FROM traffic_visits v LEFT JOIN agents g ON g.id=v.agentId WHERE v.createdAt>=? ORDER BY v.createdAt DESC LIMIT 50").bind(since).all();
  const missing=await db.prepare("SELECT COUNT(*) AS orders FROM orders o WHERE o.createdAt>=? AND NOT EXISTS(SELECT 1 FROM traffic_orders t WHERE t.orderId=o.id)").bind(since).first();
  return {days,rows:rows.results,recent:recent.results,unattributedOrders:missing?.orders || 0};
}
