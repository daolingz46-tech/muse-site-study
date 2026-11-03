import type { D1Database } from "@cloudflare/workers-types";
import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import { tokenPlans, accountPriceCents, accountTitle } from "../src/lib/products";
import { GPT_SUPPLIER_PRODUCTS, MUSE_ACCOUNT_SUPPLIER, MUSE_BASIC_SUPPLIER, SUPPLIER_BACKUPS, supplierRequest } from "./supplier16688";
import { deliveryEmail } from "./delivery-email";
import { deriveAgentPassword, payoutDueAt } from "./agent-ledger";
import { agentBalance, commissionReconciliation, withdrawalReservation } from "./agent-finance";
import { createOwnerSession, hasOwnerSession, clearOwnerSession } from "./owner-auth";
import { applyCommissionControl, type CommissionControlAction } from "./commission-controls";

type Env = { DB: D1Database; ASSETS: { fetch(request: Request): Promise<Response> }; ADMIN_PASSWORD_HASH: string; OWNER_PASSWORD_HASH?: string; RESEND_API_KEY?: string; GMAIL_SCRIPT_URL?: string; GMAIL_SCRIPT_TOKEN?: string; PUSH_PUBLIC_KEY?: string; PUSH_PRIVATE_KEY?: string; SUPPLIER_APP_ID?: string; SUPPLIER_SECRET?: string };
type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };
type Row = {
  id: string; requestHash: string; inputHash: string; tokenHash: string; code: string;
  product: "muse" | "muse-token" | "gpt"; supplierPlan: string | null; title: string; amountCents: number; target: string;
  method: "wechat" | "alipay"; status: string; createdAt: number; expiresAt: number;
  reportedAt: number | null; paidAt: number | null; completedAt: number | null;
  reference: string | null; delivery: string | null; updatedAt: number; stockIssue: number; contactEmail: string | null;
};
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...headers },
});
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
function str(value: unknown, max = 128) { return typeof value === "string" && value.trim().length <= max ? value.trim() : ""; }
type TutorialBlock = { type: "text"; content: string } | { type: "image"; url: string; caption: string };
type DeliveryFile = { id: string; orderId: string; name: string; mime: string; size: number; uploadedBytes: number };
const maxFileBytes = 15_000_000, maxMailBytes = 20_000_000, chunkBytes = 1_000_000;
const fileTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/quicktime", "video/webm"]);
const tutorialImagePattern = /^https:\/\/musetoken\.store\/api\/tutorial-images\/[a-f0-9-]{36}$/;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
function validateTutorial(value: unknown): TutorialBlock[] {
  if (!Array.isArray(value) || value.length > 30) throw new HttpError(400, "教程内容最多 30 段");
  return value.map(item => {
    if (!item || typeof item !== "object") throw new HttpError(400, "教程段落格式不正确");
    if (item.type === "text") { const content = str(item.content, 2000); if (!content) throw new HttpError(400, "请填写文字内容"); return { type: "text", content }; }
    if (item.type === "image") { const url = str(item.url, 200), caption = str(item.caption, 120); if (!tutorialImagePattern.test(url)) throw new HttpError(400, "请先上传教程图片"); return { type: "image", url, caption }; }
    throw new HttpError(400, "教程段落格式不正确");
  });
}
async function readImage(request: Request): Promise<Uint8Array> {
  const max = 700_000;
  if (Number(request.headers.get("Content-Length")) > max) throw new HttpError(413, "图片请控制在 700 KB 以内");
  const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, "请选择图片");
  const parts: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); throw new HttpError(413, "图片请控制在 700 KB 以内"); } parts.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
async function readFileChunk(request: Request): Promise<Uint8Array> {
  if (Number(request.headers.get("Content-Length")) > chunkBytes) throw new HttpError(413, "附件分片过大");
  const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, "请选择附件");
  const parts: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > chunkBytes) { await reader.cancel(); throw new HttpError(413, "附件分片过大"); } parts.push(value); }
  if (!size) throw new HttpError(400, "附件为空");
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
function base64(bytes: Uint8Array) { let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(binary); }
async function fileBytes(env: Env, id: string, size: number): Promise<Uint8Array> {
  const chunks = await env.DB.prepare("SELECT data FROM delivery_file_chunks WHERE fileId=? ORDER BY part").bind(id).all<{ data: string }>();
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks.results) { const data = atob(chunk.data); for (let i = 0; i < data.length; i++) output[offset++] = data.charCodeAt(i); }
  if (offset !== size) throw new Error("delivery_file_incomplete");
  return output;
}
async function fileSignature(env: Env, id: string) { return hash(`delivery-file:${id}:${env.GMAIL_SCRIPT_TOKEN || env.ADMIN_PASSWORD_HASH}`); }
function same(a: string, b: string) { let diff = a.length ^ b.length; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0); return diff === 0; }
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new HttpError(415, "请求格式错误");
  if (Number(request.headers.get("Content-Length")) > 8192) throw new HttpError(413, "请求内容过长");
  const reader = request.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  if (!reader) throw new HttpError(400, "缺少请求内容");
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8192) { await reader.cancel(); throw new HttpError(413, "请求内容过长"); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || Array.isArray(value) || typeof value !== "object") throw Error(); return value; }
  catch { throw new HttpError(400, "请求内容无效"); }
}
async function limit(env: Env, request: Request, action: string, max: number, seconds: number) {
  const now = Date.now(); const key = await hash(`${action}:${request.headers.get("CF-Connecting-IP") || "local"}:${Math.floor(now / (seconds * 1000))}`);
  const row = await env.DB.prepare("INSERT INTO rate_limits(key,hits,expiresAt) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits").bind(key, now + seconds * 1000).first<{ hits: number }>();
  if (!row || row.hits > max) throw new HttpError(429, "操作频繁，请稍后再试");
}
async function expire(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET status='expired',updatedAt=? WHERE status='pending' AND expiresAt<=?").bind(now, now),
    env.DB.prepare("DELETE FROM sessions WHERE expiresAt<?").bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE expiresAt<?").bind(now),
  ]);
}
async function queueOrderEmail(env: Env, order: Row, eventType: "created" | "reported", ctx: ExecutionContextLike) {
  const id = `${order.id}:${eventType}`, now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO email_outbox(id,orderId,eventType,nextAttemptAt,createdAt) VALUES(?,?,?,?,?)").bind(id, order.id, eventType, now, now).run();
  if (hasEmailConfig(env)) ctx.waitUntil(sendOrderEmails(env));
}
function hasEmailConfig(env: Env) { return Boolean(env.RESEND_API_KEY || (env.GMAIL_SCRIPT_URL && env.GMAIL_SCRIPT_TOKEN)); }
async function hasBuyerDelivery(env: Env) {
  if (env.RESEND_API_KEY && !env.GMAIL_SCRIPT_URL) return true;
  if (!env.GMAIL_SCRIPT_URL || !env.GMAIL_SCRIPT_TOKEN) return false;
  try {
    const response = await fetch(env.GMAIL_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: env.GMAIL_SCRIPT_TOKEN, purpose: "capability_probe" }), redirect: "follow", signal: AbortSignal.timeout(8000) });
    const result = await response.json().catch(() => null) as { buyerDelivery?: boolean } | null;
    return response.ok && result?.buyerDelivery === true;
  } catch { return false; }
}
async function hasAttachmentDelivery(env: Env) {
  if (env.RESEND_API_KEY && !env.GMAIL_SCRIPT_URL) return true;
  if (!env.GMAIL_SCRIPT_URL || !env.GMAIL_SCRIPT_TOKEN) return false;
  try {
    const response = await fetch(env.GMAIL_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: env.GMAIL_SCRIPT_TOKEN, purpose: "capability_probe" }), redirect: "follow", signal: AbortSignal.timeout(8000) });
    const result = await response.json().catch(() => null) as { attachments?: boolean } | null;
    return response.ok && result?.attachments === true;
  } catch { return false; }
}
async function sendEmail(env: Env, id: string, subject: string, html: string, text: string, to = "daolingz46@gmail.com", files: DeliveryFile[] = [], purpose: "owner_notice" | "buyer_delivery" = "owner_notice") {
  if (env.GMAIL_SCRIPT_URL && env.GMAIL_SCRIPT_TOKEN) {
    const attachments = await Promise.all(files.map(async file => ({ name: file.name, url: `https://musetoken.store/api/delivery-files/${file.id}?signature=${await fileSignature(env, file.id)}` })));
    const response = await fetch(env.GMAIL_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, token: env.GMAIL_SCRIPT_TOKEN, to, purpose, subject, html, text, attachments }), redirect: "follow" });
    const result = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null;
    if (!response.ok || !result?.ok) throw new Error(`gmail_script_${response.status}_${result?.message || "failed"}`);
    return;
  }
  if (!env.RESEND_API_KEY) throw new Error("email_not_configured");
  const attachments = await Promise.all(files.map(async file => ({ filename: file.name, content: base64(await fileBytes(env, file.id, file.size)) })));
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": id }, body: JSON.stringify({ from: "Muse 商店 <onboarding@resend.dev>", to: [to], subject, html, text, attachments }) });
  if (!response.ok) throw new Error(`resend_${response.status}`);
}
async function sendOrderEmails(env: Env) {
  if (!hasEmailConfig(env)) return;
  const now = Date.now();
  const pending = await env.DB.prepare("SELECT id,orderId,eventType,attempts FROM email_outbox WHERE sentAt IS NULL AND nextAttemptAt<=? ORDER BY createdAt LIMIT 5").bind(now).all<{ id: string; orderId: string; eventType: string; attempts: number }>();
  for (const item of pending.results) {
    const claimed = await env.DB.prepare("UPDATE email_outbox SET attempts=attempts+1,nextAttemptAt=? WHERE id=? AND sentAt IS NULL AND nextAttemptAt<=?").bind(now + 60000, item.id, now).run();
    if (!claimed.meta.changes) continue;
    try {
      const order = await env.DB.prepare("SELECT id,code,title,amountCents,method,createdAt,status FROM orders WHERE id=?").bind(item.orderId).first<{ id: string; code: string; title: string; amountCents: number; method: string; createdAt: number; status: string }>();
      if (!order) throw new Error("order_missing");
      const esc = (value: string) => value.replace(/[&<>\"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
      const eventText = item.eventType === "reported" ? "买家已提交付款，请核实到账" : "有新订单，请留意后续付款";
      const subject = item.eventType === "reported" ? `待核实付款：订单 ${order.code}` : `新订单：${order.title} · ${order.code}`;
      const html = `<div style="font-family:Arial,sans-serif;line-height:1.8;color:#202634"><h2>${esc(eventText)}</h2><p>订单码：<strong>${esc(order.code)}</strong></p><p>订单编号：${esc(order.id)}</p><p>商品：${esc(order.title)}</p><p>金额：¥${(order.amountCents / 100).toFixed(2)}</p><p>付款方式：${order.method === "wechat" ? "微信" : "支付宝"}</p><p>状态：${item.eventType === "reported" ? "等待店主核实" : "等待买家付款"}</p><p><a href="https://musetoken.store/admin/">打开店主工作台</a></p></div>`;
      const text = `${eventText}\n订单码：${order.code}\n订单编号：${order.id}\n商品：${order.title}\n金额：¥${(order.amountCents / 100).toFixed(2)}\n付款方式：${order.method === "wechat" ? "微信" : "支付宝"}\n状态：${item.eventType === "reported" ? "等待店主核实" : "等待买家付款"}\n店主工作台：https://musetoken.store/admin/`;
      await sendEmail(env, item.id, subject, html, text);
      await env.DB.prepare("UPDATE email_outbox SET sentAt=?,lastError=NULL WHERE id=?").bind(Date.now(), item.id).run();
    } catch (error) {
      const retryAt = Date.now() + Math.min(3600000, 15000 * 2 ** Math.min(item.attempts, 8));
      const reason = error instanceof Error ? error.message.slice(0, 120) : "send_failed";
      await env.DB.prepare("UPDATE email_outbox SET nextAttemptAt=?,lastError=? WHERE id=? AND sentAt IS NULL").bind(retryAt, reason, item.id).run();
    }
  }
}
function pushSubscription(value: unknown): PushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<PushSubscription>;
  if (typeof item.endpoint !== "string" || item.endpoint.length > 2048 || !item.keys || typeof item.keys.auth !== "string" || typeof item.keys.p256dh !== "string") return null;
  try {
    const endpoint = new URL(item.endpoint);
    const host = endpoint.hostname.toLowerCase();
    if (endpoint.protocol !== "https:" || endpoint.port || !(host.endsWith(".push.apple.com") || host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com")) return null;
  } catch { return null; }
  if (!/^[\w-]{10,100}$/.test(item.keys.auth) || !/^[\w-]{60,150}$/.test(item.keys.p256dh)) return null;
  return { endpoint: item.endpoint, expirationTime: typeof item.expirationTime === "number" ? item.expirationTime : null, keys: { auth: item.keys.auth, p256dh: item.keys.p256dh } };
}
async function deliverPush(env: Env, subscription: PushSubscription, title: string, bodyText: string, tag: string) {
  if (!env.PUSH_PUBLIC_KEY || !env.PUSH_PRIVATE_KEY) throw new Error("push_not_configured");
  const payload = await buildPushPayload({ data: JSON.stringify({ title, body: bodyText, tag }), options: { ttl: 3600, urgency: "high" } }, subscription, {
    subject: "mailto:daolingz46@gmail.com", publicKey: env.PUSH_PUBLIC_KEY, privateKey: env.PUSH_PRIVATE_KEY,
  });
  return fetch(subscription.endpoint, { ...payload, redirect: "error" });
}
async function queueOrderPush(env: Env, order: Row, eventType: "created" | "reported", ctx: ExecutionContextLike) {
  const now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO push_outbox(orderId,eventType,endpoint,nextAttemptAt,createdAt) SELECT ?,?,endpoint,?,? FROM push_subscriptions")
    .bind(order.id, eventType, now, now).run();
  if (env.PUSH_PUBLIC_KEY && env.PUSH_PRIVATE_KEY) ctx.waitUntil(sendOrderPushes(env));
}
async function sendOrderPushes(env: Env) {
  if (!env.PUSH_PUBLIC_KEY || !env.PUSH_PRIVATE_KEY) return;
  const now = Date.now();
  const pending = await env.DB.prepare("SELECT p.orderId,p.eventType,p.endpoint,p.attempts,s.subscription,o.code,o.title FROM push_outbox p JOIN push_subscriptions s ON s.endpoint=p.endpoint JOIN orders o ON o.id=p.orderId WHERE p.sentAt IS NULL AND p.nextAttemptAt<=? ORDER BY p.createdAt LIMIT 10")
    .bind(now).all<{ orderId: string; eventType: string; endpoint: string; attempts: number; subscription: string; code: string; title: string }>();
  for (const item of pending.results) {
    const claimed = await env.DB.prepare("UPDATE push_outbox SET attempts=attempts+1,nextAttemptAt=? WHERE orderId=? AND eventType=? AND endpoint=? AND sentAt IS NULL AND nextAttemptAt<=?")
      .bind(now + 60000, item.orderId, item.eventType, item.endpoint, now).run();
    if (!claimed.meta.changes) continue;
    try {
      const subscription = pushSubscription(JSON.parse(item.subscription));
      if (!subscription) throw new Error("invalid_subscription");
      const reported = item.eventType === "reported";
      const response = await deliverPush(env, subscription, reported ? "买家已反馈付款" : "Muse 商店新订单", reported ? `订单码 ${item.code}，请核实到账。` : `${item.title} · 订单码 ${item.code}`, `${item.orderId}:${item.eventType}`);
      if (response.status === 404 || response.status === 410) {
        await env.DB.batch([env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").bind(item.endpoint), env.DB.prepare("DELETE FROM push_outbox WHERE endpoint=?").bind(item.endpoint)]);
      } else if (response.ok) {
        await env.DB.prepare("UPDATE push_outbox SET sentAt=? WHERE orderId=? AND eventType=? AND endpoint=?").bind(Date.now(), item.orderId, item.eventType, item.endpoint).run();
      } else throw new Error(`push_${response.status}`);
    } catch {
      const retryAt = Date.now() + Math.min(3600000, 15000 * 2 ** Math.min(item.attempts, 8));
      await env.DB.prepare("UPDATE push_outbox SET nextAttemptAt=? WHERE orderId=? AND eventType=? AND endpoint=? AND sentAt IS NULL").bind(retryAt, item.orderId, item.eventType, item.endpoint).run();
    }
  }
}
function publicOrder(row: Row, token: string) {
  const status = row.status === "pending" && row.expiresAt <= Date.now() ? "expired" : row.status;
  return { id: row.id, token, code: row.code, product: row.product, title: row.title,
    amountCents: row.amountCents, feeCents: 0, method: row.method, status,
    createdAt: row.createdAt, expiresAt: row.expiresAt, reportedAt: row.reportedAt, stockIssue: row.stockIssue === 1,
    ...(row.product !== "muse-token" ? { email: row.target } : { inviteCode: row.target }),
    qrImageUrl: `/api/payment-qr/${row.method}`, delivery: row.delivery ? JSON.parse(row.delivery) : undefined };
}
async function getOrder(env: Env, input: Record<string, unknown>) {
  const id = str(input.id, 64), token = str(input.token, 64);
  if (!id || !token) throw new HttpError(400, "请填写订单号和查询口令");
  const row = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first<Row>();
  if (row && !same(row.tokenHash, await hash(token)) && !same(token, await hash(`order-id-access:${id}`))) throw new HttpError(404, "订单不存在或查询口令不正确");
  if (!row) throw new HttpError(404, "订单不存在或查询口令不正确");
  return { row, token };
}
async function createOrder(env: Env, request: Request, input: Record<string, unknown>, ctx: ExecutionContextLike) {
  const requestId = str(input.requestId, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new HttpError(400, "请重新提交订单");
  if (input.acceptedTerms !== true) throw new HttpError(400, "请先同意购买须知");
  if (input.method !== "wechat" && input.method !== "alipay") throw new HttpError(400, "请选择支付方式");
  let title: string, amount: number, target: string;
  if (input.product === "muse") { if (input.planId !== undefined && !["basic", "warranty"].includes(String(input.planId))) throw new HttpError(400, "商品规格无效"); const basic = input.planId === "basic"; title = basic ? `${accountTitle} · 无七天质保` : input.planId === "warranty" ? `${accountTitle} · 7 天质保` : accountTitle; amount = basic ? 1400 : accountPriceCents; target = str(input.email, 254); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) throw new HttpError(400, "请填写有效邮箱"); }
  else if (input.product === "gpt") { if (typeof input.planId !== "string" || !Object.hasOwn(GPT_SUPPLIER_PRODUCTS, input.planId)) throw new HttpError(400, "商品不存在"); const plan = GPT_SUPPLIER_PRODUCTS[input.planId as keyof typeof GPT_SUPPLIER_PRODUCTS]; title = plan.title; amount = plan.priceCents; target = str(input.email, 254); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) throw new HttpError(400, "请填写有效邮箱"); if (input.planId === "halfPriceTopup" && input.eligibleConfirmed !== true) throw new HttpError(400, "请确认账号具有半价资格"); }
  else if (input.product === "muse-token") { const plan = tokenPlans.find(p => p.id === input.planId); if (!plan) throw new HttpError(400, "充值档次无效"); amount = plan.amountCents; title = `Muse Token · ${plan.label}`; target = str(input.inviteCode); if (!target) throw new HttpError(400, "账号邀请码为必填项"); }
  else throw new HttpError(400, "商品不存在");
  const contactEmail = input.product === "muse-token" && input.email ? str(input.email, 254) : "";
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new HttpError(400, "请填写有效邮箱");
  const requestHash = await hash(requestId), token = await hash(`order-lookup:${requestId}`);
  const inputHash = await hash(JSON.stringify(contactEmail ? [input.product, title, amount, target, input.method, contactEmail] : [input.product, title, amount, target, input.method]));
  const legacyInputHash = input.product === "muse" ? await hash(JSON.stringify([input.product, "Muse AI · 成品账号", amount, target, input.method])) : "";
  const matchesInput = async (row: Row) => {
    if (row.inputHash === inputHash || row.inputHash === legacyInputHash) return true;
    const original = await hash(JSON.stringify(contactEmail ? [input.product, title, row.amountCents, target, input.method, contactEmail] : [input.product, title, row.amountCents, target, input.method]));
    const legacy = input.product === "muse" ? await hash(JSON.stringify([input.product, "Muse AI · 成品账号", row.amountCents, target, input.method])) : "";
    return row.inputHash === original || row.inputHash === legacy;
  };
  const existing = await env.DB.prepare("SELECT * FROM orders WHERE requestHash=?").bind(requestHash).first<Row>();
  if (existing) { if (!await matchesInput(existing)) throw new HttpError(409, "订单内容已改变，请重新下单"); await queueOrderEmail(env, existing, "created", ctx); return json(publicOrder(existing, token)); }
  await limit(env, request, "create", 20, 3600);
  await expire(env);
  const now = Date.now(), id = `M${crypto.randomUUID().replaceAll("-", "")}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    let code = (crypto.getRandomValues(new Uint32Array(1))[0] % 10000).toString().padStart(4, "0");
    if (attempt >= 35) {
      const free = await env.DB.prepare("WITH RECURSIVE numbers(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM numbers WHERE n<9999) SELECT printf('%04d',n) AS code FROM numbers WHERE NOT EXISTS(SELECT 1 FROM orders WHERE code=printf('%04d',n)) LIMIT 1").first<{code: string}>();
      if (!free) throw new HttpError(503, "四位订单码已用完，请联系店主升级订单编号规则");
      code = free.code;
    }
    const referralCode = str(input.referralCode,32);
    if (referralCode && !/^[a-f0-9]{32}$/.test(referralCode)) throw new HttpError(400,"推广码格式无效");
    const productKey = input.product === "muse" ? (input.planId === "basic" ? "museAccountBasic" : "museAccount") : `${input.product}:${input.planId}`;
    const [result] = await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO orders(id,requestHash,inputHash,tokenHash,code,product,title,amountCents,target,method,createdAt,expiresAt,updatedAt,supplierPlan,contactEmail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, requestHash, inputHash, await hash(token), code, input.product, title, amount, target, input.method, now, now + 15 * 60000, now, input.product === "gpt" ? String(input.planId) : input.product === "muse" ? (input.planId === "basic" ? "museBasic" : "museWarranty") : null, contactEmail || null),
      env.DB.prepare("INSERT INTO agent_order_attribution(orderId,agentId,productKey,commissionCents,ruleVersion,createdAt) SELECT ?,a.id,?,COALESCE(r.amountCents,0),COALESCE(r.updatedAt,0),? FROM agents a LEFT JOIN agent_commission_rules r ON r.productKey=? WHERE a.referralCode=? AND a.status='active' AND changes()=1").bind(id,productKey,now,productKey,referralCode),
    ]);
    const row = await env.DB.prepare("SELECT * FROM orders WHERE requestHash=?").bind(requestHash).first<Row>();
    if (row) { if (!await matchesInput(row)) throw new HttpError(409, "订单内容已改变，请重新下单"); await queueOrderEmail(env, row, "created", ctx); if (result.meta.changes) await queueOrderPush(env, row, "created", ctx); return json(publicOrder(row, token), result.meta.changes ? 201 : 200); }
  }
  throw new HttpError(503, "当前订单较多，请稍后再试或联系支持");
}
function cookie(request: Request) { return request.headers.get("Cookie")?.match(/(?:^|;\s*)muse_admin=([a-f0-9]{64})(?:;|$)/)?.[1] || ""; }
function adminSession(request: Request) { return cookie(request) || request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] || ""; }
function cookieHeader(request: Request, value: string, age: number) { const secure = new URL(request.url).protocol === "https:"; return `muse_admin=${value}; HttpOnly; SameSite=${secure ? "None" : "Lax"}; Path=/api/admin; Max-Age=${age}${secure ? "; Secure" : ""}`; }
async function requireAdmin(env: Env, request: Request) {
  const session = adminSession(request);
  if (!session || !await env.DB.prepare("SELECT hash FROM sessions WHERE hash=? AND expiresAt>?").bind(await hash(session), Date.now()).first()) throw new HttpError(401, "请登录工作台");
}
function agentProducts() {
  return [
    { productKey: "museAccount", name: `${accountTitle} · 7 天质保`, priceCents: accountPriceCents, category: "Muse" },
    { productKey: "museAccountBasic", name: `${accountTitle} · 基础款`, priceCents: 1400, category: "Muse" },
    ...tokenPlans.map(plan => ({ productKey: `muse-token:${plan.id}`, name: `Muse Token · ${plan.label}`, priceCents: plan.amountCents, category: "Muse Token" })),
    ...Object.entries(GPT_SUPPLIER_PRODUCTS).filter(([key]) => key !== "halfPriceAccount").map(([key,plan]) => ({ productKey: `gpt:${key}`, name: plan.title, priceCents: plan.priceCents, category: "GPT" })),
  ];
}
async function agentApi(env: Env, request: Request, path: string) {
  if (path === "/api/agent/login" && request.method === "POST") {
    await limit(env,request,"agent-login",8,900);
    const input=await body(request), code=str(input.code,32), password=typeof input.password === "string" ? input.password : "";
    if (!/^[a-f0-9]{32}$/.test(code) || password.length<12 || password.length>256) throw new HttpError(401,"代理账号或密码不正确");
    const agent=await env.DB.prepare("SELECT a.id,c.salt,c.passwordHash,c.iterations FROM agents a JOIN agent_credentials c ON c.agentId=a.id WHERE a.referralCode=? AND a.status='active'").bind(code).first<{id:string;salt:string;passwordHash:string;iterations:number}>();
    const candidate=await deriveAgentPassword(password,agent?.salt || "0".repeat(32),agent?.iterations || 100000);
    if (!agent || !same(candidate,agent.passwordHash)) throw new HttpError(401,"代理账号或密码不正确");
    const session=await hash(crypto.randomUUID()+crypto.randomUUID());
    const inserted=await env.DB.prepare("INSERT INTO agent_sessions(hash,agentId,expiresAt) SELECT ?,id,? FROM agents WHERE id=? AND status='active'").bind(await hash(session),Date.now()+8*3600000,agent.id).run();
    if (!inserted.meta.changes) throw new HttpError(401,"代理账号或密码不正确");
    const secure=new URL(request.url).protocol === "https:";
    return json({ok:true},200,{"Set-Cookie":`agent_session=${session}; HttpOnly; SameSite=${secure?"None":"Lax"}; Path=/api/agent; Max-Age=28800${secure?"; Secure":""}`});
  }
  const session=request.headers.get("Cookie")?.match(/(?:^|;\s*)agent_session=([a-f0-9]{64})(?:;|$)/)?.[1] || "";
  const agent=session && await env.DB.prepare("SELECT a.id,a.name,a.referralCode FROM agent_sessions s JOIN agents a ON a.id=s.agentId WHERE s.hash=? AND s.expiresAt>? AND a.status='active'").bind(await hash(session),Date.now()).first<{id:string;name:string;referralCode:string}>();
  if (!agent) throw new HttpError(401,"请登录代理工作台");
  if (path === "/api/agent/me" && request.method === "GET") return json({id:agent.id,name:agent.name,referralCode:agent.referralCode});
  if (path === "/api/agent/orders" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT o.code,o.title,o.status,o.createdAt,a.commissionCents,a.ruleVersion,CASE WHEN c.state='hold' THEN 'hold' WHEN c.state='refunded' THEN 'refunded' WHEN a.ruleVersion=0 THEN 'unconfigured' WHEN a.commissionCents>o.amountCents THEN 'review' WHEN o.status!='complete' OR o.paidAt IS NULL OR o.completedAt IS NULL THEN 'awaiting' WHEN ((MAX(o.paidAt,o.completedAt)+28800000)/86400000+1)*86400000-28800000>? THEN 'pending' ELSE 'matured' END AS commissionState FROM agent_order_attribution a JOIN orders o ON o.id=a.orderId LEFT JOIN commission_controls c ON c.orderId=a.orderId WHERE a.agentId=? ORDER BY o.createdAt DESC LIMIT 100").bind(Date.now(),agent.id).all();
    return json({agentId:agent.id,orders:rows.results},200,{"Cache-Control":"no-store"});
  }
  if (path === "/api/agent/balance" && request.method === "GET") return json({agentId:agent.id,...await agentBalance(env.DB,agent.id,Date.now())});
  if (path === "/api/agent/withdrawals" && request.method === "GET") {
    const rows=await env.DB.prepare("SELECT id,amountCents,status,requestedAt,dueAt FROM agent_withdrawals WHERE agentId=? ORDER BY requestedAt DESC LIMIT 100").bind(agent.id).all();
    return json({agentId:agent.id,withdrawals:rows.results});
  }
  if (path === "/api/agent/withdrawals" && request.method === "POST") {
    const input=await body(request), requestId=str(input.requestId,64), amount=input.amountCents;
    if (input.expectedAgentId !== agent.id) throw new HttpError(409,"代理账号已变化，请重新登录核对");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) || !Number.isSafeInteger(amount) || Number(amount)<=0 || Number(amount)>10000000) throw new HttpError(400,"提现金额或请求无效");
    await limit(env,request,"agent-withdrawal",20,3600);
    const id=await hash(`withdrawal:${agent.id}:${requestId}`), now=Date.now();
    await env.DB.batch([commissionReconciliation(env.DB,agent.id,now),withdrawalReservation(env.DB,agent.id,id,Number(amount),now)]);
    const withdrawal=await env.DB.prepare("SELECT id,amountCents,status,requestedAt,dueAt FROM agent_withdrawals WHERE id=? AND agentId=?").bind(id,agent.id).first<{amountCents:number}>();
    if (!withdrawal) throw new HttpError(409,"可提现余额不足，请刷新后重试");
    if (withdrawal.amountCents!==amount) throw new HttpError(409,"提现内容已改变，请重新提交");
    return json({withdrawal});
  }
  if (path === "/api/agent/logout" && request.method === "POST") { await env.DB.prepare("DELETE FROM agent_sessions WHERE hash=?").bind(await hash(session)).run(); const secure=new URL(request.url).protocol === "https:"; return json({ok:true},200,{"Set-Cookie":`agent_session=; HttpOnly; SameSite=${secure?"None":"Lax"}; Path=/api/agent; Max-Age=0${secure?"; Secure":""}`}); }
  throw new HttpError(404,"接口不存在");
}
async function chooseSupplier(env: Env, order: Row, primary: string) {
  const candidates = [primary, ...(order.supplierPlan ? SUPPLIER_BACKUPS[order.supplierPlan] || [] : [])];
  for (const goodsNo of candidates) {
    let quote: { code:number; data?: { total_amount?:number; unit_price?:number; available_quantity?:number; balance_enough?:boolean } };
    try { quote = await supplierRequest({appId:env.SUPPLIER_APP_ID!,secret:env.SUPPLIER_SECRET!},"purchase","quotePrice",{goods_no:goodsNo,quantity:1}) as typeof quote; }
    catch { throw new HttpError(502,"货源询价失败，未执行采购；请稍后重试。"); }
    if (quote.code !== 1 || !quote.data) throw new HttpError(409,"货源询价未确认，未执行采购。");
    if (quote.data.available_quantity === 0) continue;
    const total=Number(quote.data.total_amount);
    if (!Number.isFinite(total) || total <= 0) throw new HttpError(409,"货源价格未确认，未执行采购。");
    if (quote.data.balance_enough !== true) throw new HttpError(409,`运营钱包余额不足，本次需 ¥${total.toFixed(2)}（含手续费）。`);
    if (Math.round(total*100)>order.amountCents) throw new HttpError(409,"货源成本高于售价，未执行采购。");
    const supplierName:Record<string,string>={G95786160:"huaiyesu",G88655555:"lzz_ai小铺",G75777360:"原货源商",G17614190:"AI源头"};
    return { goodsNo, supplierName:supplierName[goodsNo] || "16688 货源", total, unitPrice:quote.data.unit_price };
  }
  throw new HttpError(409,"已配置货源均缺货，未执行采购。");
}

const qualificationGuide = `请使用电脑登录，手机端可能不显示优惠。\n1. 使用收到的账号、密码登录 ChatGPT 官方网页；如需 2FA 验证，可使用验证器或 https://2fa.fun/ 获取验证码。\n2. 点击 Upgrade to Plus（升级 Plus），在支付页面查看是否显示半价优惠。\n3. 准备官方支持的支付卡，并确保余额充足；也可自行选购有额度的虚拟卡。\n4. 仅在官方支付页面填写卡号、有效期及 CVV，确认订阅。\n5. 请尽快使用优惠，一个月半价资格未使用可能失效；如需更长优惠，可考虑两个月或三个月资格。首登如需邮箱验证码，请联系商家协助更换账号。`;
const newQualificationGuide = `此商品是半价资格账号，不含 Plus 订阅。半价资格为 1–3 个月随机，实际期限以账号显示为准。若收到 Go 试用号，请联系店主更换。请在 1 小时内首次登录并检查账号。
1. 使用收到的账号和密码登录 ChatGPT 官方网页；如需双重验证，请使用验证器生成一次性验证码（可参考 https://2fa.fun/）。
2. 点击 Upgrade to Plus，在官方支付页面确认是否显示半价优惠。
3. 使用官方支持的支付卡，在官方支付页面填写卡片信息并完成订阅；请勿将卡号或验证码发送给他人。
4. 升级后检查订阅状态。供货商只保证账号具备优惠资格，不保证支付一定成功。本商品不含接码服务；如需协助请联系店主。`;
const halfPriceTopupGuide = `本商品为菲律宾渠道 Plus 一个月半价代充，使用前请先确认账号有半价资格。\n账号须为 Free 状态，不能覆盖已有订阅。新号及老号均可使用，具体以账号资格为准。\n可参考资格查询文档：https://docs.qq.com/doc/DY2plWm9pdVhXb0Fs\n供货商说明提供 30 天订阅质保；封号不在其质保范围。请保留订单信息，遇到问题及时联系店主。`;
function inventoryProducts(order: Row): string[] {
  if (order.product === "muse") return [order.supplierPlan === "museWarranty" ? "muse-7day" : order.supplierPlan === "museBasic" ? "muse-basic-43844575" : "muse"];
  const plan=GPT_SUPPLIER_PRODUCTS[order.supplierPlan as keyof typeof GPT_SUPPLIER_PRODUCTS];
  return plan ? [plan.goodsNo,...(order.supplierPlan ? SUPPLIER_BACKUPS[order.supplierPlan] || [] : [])].map(no=>`gpt:${no}`) : [];
}

async function admin(env: Env, request: Request, path: string) {
  if ((path === "/api/admin/login" || path === "/api/admin/mini-login") && request.method === "POST") {
    const miniLogin = path.endsWith("/mini-login");
    if (miniLogin && request.headers.has("Origin")) throw new HttpError(403, "请求来源无效");
    await limit(env, request, "login", 8, 900);
    if (!/^[a-f0-9]{64}$/.test(env.ADMIN_PASSWORD_HASH || "")) throw new HttpError(503, "工作台尚未配置登录密码");
    const input = await body(request); const password = str(input.password, 256);
    if (!password || !same(await hash(password), env.ADMIN_PASSWORD_HASH)) throw new HttpError(401, "密码不正确");
    const session = await hash(crypto.randomUUID() + crypto.randomUUID());
    await env.DB.prepare("INSERT INTO sessions(hash,expiresAt) VALUES(?,?)").bind(await hash(session), Date.now() + 8 * 3600000).run();
    return miniLogin ? json({ ok: true, session }) : json({ ok: true }, 200, { "Set-Cookie": cookieHeader(request, session, 28800) });
  }
  await requireAdmin(env, request);
  if (path === "/api/admin/owner-login" && request.method === "POST") {
    await limit(env,request,"owner-login",6,900);
    const input=await body(request), password=typeof input.password === "string" ? input.password : "";
    const result=await createOwnerSession(env,adminSession(request),password);
    if (!result.ok) throw new HttpError(result.reason === "unconfigured" ? 503 : 401,result.reason === "unconfigured" ? "店主审批密码尚未配置" : "店主审批密码不正确");
    return json({ok:true},200,{"Set-Cookie":result.setCookie});
  }
  if (path === "/api/admin/owner-logout" && request.method === "POST") return json({ok:true},200,{"Set-Cookie":await clearOwnerSession(env,request)});
  if (path.startsWith("/api/admin/owner-")) {
    if (!await hasOwnerSession(env,request,adminSession(request))) throw new HttpError(401,"请先验证店主审批密码");
    if (path === "/api/admin/owner-commission" && request.method === "GET") {
      const code=new URL(request.url).searchParams.get("code") || "";
      if (!/^\d{4}$/.test(code)) throw new HttpError(400,"请输入 4 位订单码");
      const row=await env.DB.prepare("SELECT o.id AS orderId,o.code,g.name AS agentName,a.commissionCents AS amountCents,EXISTS(SELECT 1 FROM agent_withdrawals w WHERE w.agentId=a.agentId AND w.status IN ('paying','unknown')) AS payoutInFlight,CASE WHEN a.ruleVersion=0 OR a.commissionCents>o.amountCents THEN 'unconfigured' WHEN c.state='hold' THEN 'held' WHEN c.state='refunded' THEN 'refunded' ELSE 'active' END AS state FROM orders o JOIN agent_order_attribution a ON a.orderId=o.id JOIN agents g ON g.id=a.agentId LEFT JOIN commission_controls c ON c.orderId=o.id WHERE o.code=?").bind(code).first<{payoutInFlight:number;[key:string]:unknown}>();
      return json({commission:row ? {...row,payoutInFlight:!!row.payoutInFlight} : null});
    }
    if (path === "/api/admin/owner-commission-action" && request.method === "POST") {
      const input=await body(request), orderId=str(input.orderId,64), action=str(input.action,10), reason=str(input.reason,500), requestId=str(input.requestId,64);
      if (!/^M[a-f0-9]{32}$/.test(orderId) || !["hold","release","refund"].includes(action) || reason.length<10 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new HttpError(400,"佣金操作或原因无效");
      const row=await env.DB.prepare("SELECT a.orderId FROM agent_order_attribution a JOIN orders o ON o.id=a.orderId WHERE a.orderId=? AND a.ruleVersion>0 AND a.commissionCents<=o.amountCents").bind(orderId).first();
      if (!row) throw new HttpError(409,"佣金未配置或需核查，暂不能操作");
      const result=await applyCommissionControl(env.DB,{orderId,operationId:requestId,action:action as CommissionControlAction,reason,now:Date.now()});
      if (!result.ok) throw new HttpError(409,"佣金状态已变更，或该代理有打款中、待核查的提现，请先核对后重新查询");
      return json({ok:true,replay:result.replay});
    }
    if (path === "/api/admin/owner-withdrawals" && request.method === "GET") {
      const rawPage=new URL(request.url).searchParams.get("page") || "0";
      if (!/^\d{1,5}$/.test(rawPage)) throw new HttpError(400,"页码无效");
      const page=Number(rawPage);
      const rows=await env.DB.prepare("SELECT w.id,w.agentId,a.name AS agentName,w.amountCents,w.status,w.requestedAt,w.approvedAt,w.dueAt,w.paidAt,w.paymentReference FROM agent_withdrawals w JOIN agents a ON a.id=w.agentId ORDER BY CASE WHEN w.status IN ('pending','approved','paying','unknown') THEN 0 ELSE 1 END,w.requestedAt ASC,w.id ASC LIMIT 51 OFFSET ?").bind(page*50).all();
      return json({withdrawals:rows.results.slice(0,50),page,hasMore:rows.results.length>50});
    }
    if (path === "/api/admin/owner-withdrawal-action" && request.method === "POST") {
      const input=await body(request), id=str(input.id,64), action=str(input.action,20), now=Date.now();
      if (!/^[a-f0-9]{64}$/.test(id) || !["approve","reject","begin_payout","mark_unknown","mark_paid","release_unpaid"].includes(action)) throw new HttpError(400,"提现操作无效");
      const reference=action === "mark_paid" ? str(input.paymentReference,100) : "";
      const note=action === "release_unpaid" ? str(input.verificationNote,500) : "";
      if (action === "release_unpaid" && (input.confirmedNoTransfer !== true || note.length<10)) throw new HttpError(400,"请确认未转账并填写至少 10 字的核查说明");
      if (action === "mark_paid" && reference.length<6) throw new HttpError(400,"请填写至少 6 位的转账流水号");
      const before=await env.DB.prepare("SELECT status,dueAt,paymentReference FROM agent_withdrawals WHERE id=?").bind(id).first<{status:string;dueAt:number|null;paymentReference:string|null}>();
      if (!before) throw new HttpError(404,"提现申请不存在");
      if (action === "begin_payout" && before.status === "paying") throw new HttpError(409,"该申请已开始打款，请先核查转账状态，勿重复转账");
      if ((action === "approve" && before.status === "approved") || (action === "reject" && before.status === "rejected") || (action === "mark_unknown" && before.status === "unknown") || (action === "mark_paid" && before.status === "paid" && before.paymentReference === reference)) return json({ok:true});
      if (action === "begin_payout" && before.status === "approved" && (before.dueAt === null || before.dueAt>now)) throw new HttpError(409,"尚未到批准后的次日，不能开始打款");
      const covered=" AND NOT EXISTS(SELECT 1 FROM agent_order_attribution x JOIN commission_controls c ON c.orderId=x.orderId WHERE x.agentId=agent_withdrawals.agentId AND c.state='hold') AND COALESCE((SELECT SUM(l.amountCents) FROM agent_ledger l WHERE l.agentId=agent_withdrawals.agentId AND l.availableAt<=? AND l.kind IN ('commission','adjustment')),0)>=COALESCE((SELECT SUM(w.amountCents) FROM agent_withdrawals w WHERE w.agentId=agent_withdrawals.agentId AND w.status IN ('pending','approved','paying','unknown','paid')),0)";
      const sql=action === "approve" ? "UPDATE agent_withdrawals SET status='approved',approvedAt=?,dueAt=?,updatedAt=? WHERE id=? AND status='pending'"+covered
        : action === "reject" ? "UPDATE agent_withdrawals SET status='rejected',updatedAt=? WHERE id=? AND status IN ('pending','approved')"
        : action === "begin_payout" ? "UPDATE agent_withdrawals SET status='paying',updatedAt=? WHERE id=? AND status='approved' AND dueAt<=?"+covered
        : action === "mark_unknown" ? "UPDATE agent_withdrawals SET status='unknown',updatedAt=? WHERE id=? AND status='paying'"
        : action === "release_unpaid" ? "UPDATE agent_withdrawals SET status='rejected',updatedAt=? WHERE id=? AND status='unknown'"
        : "UPDATE agent_withdrawals SET status='paid',paidAt=?,updatedAt=?,paymentReference=? WHERE id=? AND status IN ('paying','unknown')";
      const statement=action === "approve" ? env.DB.prepare(sql).bind(now,payoutDueAt(now),now,id,now) : action === "reject" || action === "mark_unknown" || action === "release_unpaid" ? env.DB.prepare(sql).bind(now,id) : action === "begin_payout" ? env.DB.prepare(sql).bind(now,id,now,now) : env.DB.prepare(sql).bind(now,now,reference,id);
      let result;
      try { result=await env.DB.batch([statement,env.DB.prepare("INSERT INTO withdrawal_audit(withdrawalId,action,createdAt,detail) SELECT ?,?,?,? WHERE changes()=1").bind(id,action,now,note || null)]); }
      catch (error) { if (String(error).includes("UNIQUE")) throw new HttpError(409,"该转账流水号已用于其他提现，请核对"); throw error; }
      if (!result[0].meta.changes) throw new HttpError(409,"提现状态已变更，请刷新后核对");
      return json({ok:true});
    }
    throw new HttpError(404,"接口不存在");
  }
  if (path === "/api/admin/agents" && request.method === "GET") {
    const agents = await env.DB.prepare("SELECT a.id,a.name,a.referralCode,a.status,a.createdAt,COUNT(o.id) AS orderCount,COALESCE(SUM(CASE WHEN o.status='complete' THEN 1 ELSE 0 END),0) AS completedOrderCount FROM agents a LEFT JOIN agent_order_attribution x ON x.agentId=a.id LEFT JOIN orders o ON o.id=x.orderId GROUP BY a.id ORDER BY a.createdAt DESC LIMIT 200").all();
    const rules = await env.DB.prepare("SELECT productKey,amountCents,updatedAt FROM agent_commission_rules ORDER BY productKey").all();
    return json({agents:agents.results,rules:rules.results,products:agentProducts()});
  }
  if (path === "/api/admin/agent-orders" && request.method === "GET") {
    const params = new URL(request.url).searchParams, agentId = params.get("agentId") || "", page = Number(params.get("page") || 0);
    if (!/^[a-f0-9-]{36}$/i.test(agentId) || !Number.isSafeInteger(page) || page < 0 || page > 10000) throw new HttpError(400, "代理或页码无效");
    if (!await env.DB.prepare("SELECT id FROM agents WHERE id=?").bind(agentId).first()) throw new HttpError(404, "代理不存在");
    const rows = await env.DB.prepare(`SELECT o.code,o.title,o.status,o.amountCents,o.target,o.contactEmail,o.createdAt,o.paidAt,o.completedAt,a.commissionCents,a.ruleVersion,
      CASE WHEN c.state='hold' THEN 'hold' WHEN c.state='refunded' THEN 'refunded' WHEN a.ruleVersion=0 THEN 'unconfigured' WHEN a.commissionCents>o.amountCents THEN 'review' WHEN o.status!='complete' OR o.paidAt IS NULL OR o.completedAt IS NULL THEN 'awaiting' WHEN ((MAX(o.paidAt,o.completedAt)+28800000)/86400000+1)*86400000-28800000>? THEN 'pending' ELSE 'matured' END AS settlement,
      CASE WHEN o.paidAt IS NOT NULL AND o.completedAt IS NOT NULL THEN ((MAX(o.paidAt,o.completedAt)+28800000)/86400000+1)*86400000-28800000 ELSE NULL END AS availableAt
      FROM agent_order_attribution a JOIN orders o ON o.id=a.orderId LEFT JOIN commission_controls c ON c.orderId=o.id WHERE a.agentId=? ORDER BY o.createdAt DESC,o.id DESC LIMIT 51 OFFSET ?`).bind(Date.now(),agentId,page*50).all();
    return json({orders:rows.results.slice(0,50),hasMore:rows.results.length>50,page},200,{"Cache-Control":"no-store"});
  }
  if (["/api/admin/agent-create","/api/admin/agent-status","/api/admin/agent-rule"].includes(path) && request.method === "POST" && !await hasOwnerSession(env,request,adminSession(request))) throw new HttpError(401,"请先完成店主认证");
  if (path === "/api/admin/agent-create" && request.method === "POST") {
    const input=await body(request), name=str(input.name,80), password=typeof input.password === "string" ? input.password : "";
    if (!name || password.length < 12 || password.length > 256) throw new HttpError(400,"请填写代理名称和至少 12 位密码");
    const id=crypto.randomUUID(), referralCode=crypto.randomUUID().replaceAll("-", ""), salt=crypto.randomUUID().replaceAll("-", ""), now=Date.now();
    const passwordHash=await deriveAgentPassword(password,salt);
    await env.DB.batch([env.DB.prepare("INSERT INTO agents(id,name,referralCode,status,createdAt) VALUES(?,?,?,'active',?)").bind(id,name,referralCode,now),env.DB.prepare("INSERT INTO agent_credentials(agentId,salt,passwordHash,iterations,createdAt) VALUES(?,?,?,100000,?)").bind(id,salt,passwordHash,now),env.DB.prepare("INSERT INTO agent_audit(action,agentId,createdAt) VALUES('create',?,?)").bind(id,now)]);
    return json({id,name,referralCode},201);
  }
  if (path === "/api/admin/agent-status" && request.method === "POST") {
    const input=await body(request), id=str(input.id,64), status=input.status;
    if (status !== "active" && status !== "disabled") throw new HttpError(400,"状态无效");
    const result=await env.DB.batch([
      env.DB.prepare("UPDATE agents SET status=? WHERE id=?").bind(status,id),
      env.DB.prepare("DELETE FROM agent_sessions WHERE agentId=? AND ?='disabled'").bind(id,status),
      env.DB.prepare("INSERT INTO agent_audit(action,agentId,createdAt) SELECT ?,id,? FROM agents WHERE id=?").bind(status,Date.now(),id),
    ]);
    if (!result[0].meta.changes) throw new HttpError(404,"代理不存在");
    return json({ok:true});
  }
  if (path === "/api/admin/agent-rule" && request.method === "POST") {
    const input=await body(request), productKey=str(input.productKey,80), amountCents=input.amountCents;
    const product = agentProducts().find(item => item.productKey === productKey);
    if (!product || !Number.isSafeInteger(amountCents) || Number(amountCents)<0 || Number(amountCents)>product.priceCents) throw new HttpError(400,"佣金金额无效，不能超过商品售价");
    const now=Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO agent_commission_rules(productKey,amountCents,updatedAt) VALUES(?,?,?) ON CONFLICT(productKey) DO UPDATE SET amountCents=excluded.amountCents,updatedAt=excluded.updatedAt").bind(productKey,amountCents,now),
      env.DB.prepare("INSERT INTO agent_audit(action,productKey,amountCents,createdAt) VALUES('rule',?,?,?)").bind(productKey,amountCents,now),
    ]);
    return json({ok:true});
  }
  if (path === "/api/admin/customer-timeline" && request.method === "POST") {
    const input = await body(request), id = str(input.id, 64);
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first<Row>();
    const email = order?.product === "muse-token" ? order.contactEmail : order?.target;
    if (!order || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400,"订单没有有效联系邮箱");
    const related = await env.DB.prepare("SELECT id,code,title,status,createdAt,paidAt,completedAt FROM orders WHERE lower(CASE WHEN product='muse-token' THEN contactEmail ELSE target END)=lower(?) ORDER BY createdAt DESC LIMIT 100").bind(email).all<{id:string;code:string;title:string;status:string;createdAt:number}>();
    if (!env.GMAIL_SCRIPT_URL || !env.GMAIL_SCRIPT_TOKEN) return json({email,orders:related.results,messages:[],mailError:"邮箱读取尚未配置"});
    let result: {ok?:boolean;message?:string;messages?:Array<{subject:string;[key:string]:unknown}>};
    try { const response=await fetch(env.GMAIL_SCRIPT_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:env.GMAIL_SCRIPT_TOKEN,purpose:"customer_threads",email}),redirect:"follow",signal:AbortSignal.timeout(15000)}); result=await response.json(); }
    catch { return json({email,orders:related.results,messages:[],mailError:"邮箱读取失败，请检查邮件桥接部署和授权"}); }
    if (!result.ok || !Array.isArray(result.messages)) {
      const reasons: Record<string,string> = { unauthorized:"邮件桥接令牌不匹配，请检查脚本属性与线上配置", invalid_id:"线上邮件桥接仍是旧版本，请在原部署选择新版本并部署", invalid_purpose:"线上邮件桥接仍是旧版本，请在原部署选择新版本并部署", invalid_email:"邮箱地址未通过邮件桥接校验", send_failed:"邮件桥接执行失败；请检查 Apps Script 的执行记录及 Gmail 授权" };
      return json({email,orders:related.results,messages:[],mailError:reasons[result.message || ""] || "邮件桥接返回异常，请检查部署和授权"});
    }
    const messages=result.messages.map(message=>{const matches=related.results.filter(o=>new RegExp(`(?:订单\\s*)${o.code}(?!\\d)`).test(message.subject || ""));return {...message,matchedOrder:matches.length===1?matches[0].code:null};});
    return json({email,orders:related.results,messages});
  }
  if (path === "/api/admin/customer-reply" && request.method === "POST") {
    const input=await body(request), id=str(input.id,64), messageId=str(input.messageId,128), message=str(input.message,3000), requestId=str(input.requestId,64);
    const order=await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first<Row>();
    const email=order?.product === "muse-token" ? order.contactEmail : order?.target;
    if (!order || !email || !message || !/^[A-Za-z0-9_-]{1,128}$/.test(messageId) || !/^[a-f0-9-]{36}$/.test(requestId)) throw new HttpError(400,"回复信息无效");
    if (!env.GMAIL_SCRIPT_URL || !env.GMAIL_SCRIPT_TOKEN) throw new HttpError(503,"邮件桥接尚未配置");
    try { const response=await fetch(env.GMAIL_SCRIPT_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:env.GMAIL_SCRIPT_TOKEN,purpose:"customer_reply",email,messageId,text:message,id:`reply:${requestId}`}),redirect:"follow",signal:AbortSignal.timeout(20000)}); const result=await response.json() as {ok?:boolean}; if (!result.ok) throw new Error("reply_failed"); }
    catch { throw new HttpError(502,"回复结果未确认，请先核查 Gmail 发件箱后再重试"); }
    await env.DB.prepare("INSERT INTO audit(orderId,action,createdAt) VALUES(?,'customer_reply',?)").bind(id,Date.now()).run(); return json({ok:true});
  }
  if (path === "/api/admin/contact-buyer" && request.method === "POST") {
    const input = await body(request), id = str(input.id, 64), message = str(input.message, 3000);
    if (!message) throw new HttpError(400, "请填写要发送给客户的内容");
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first<Row>();
    const recipient = order?.product === "muse-token" ? order.contactEmail : order?.target;
    if (!order || !recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new HttpError(400, "此订单没有收件邮箱，无法发送邮件");
    if (!hasEmailConfig(env) || !await hasBuyerDelivery(env)) throw new HttpError(503, "买家邮件服务尚未启用");
    const text = `订单 ${order.code} · ${order.title}\n\n${message}\n\nMuse 商店`;
    const html = `<div style="font-family:Arial;line-height:1.8"><h2>Muse 商店订单消息</h2><p>订单 ${escapeHtml(order.code)} · ${escapeHtml(order.title)}</p><p style="white-space:pre-wrap">${escapeHtml(message)}</p></div>`;
    try { await sendEmail(env, `contact:${crypto.randomUUID()}`, `Muse 商店订单消息 · ${order.code}`, html, text, recipient, [], "buyer_delivery"); }
    catch { throw new HttpError(502, "邮件发送结果不明，请先检查发件箱后再重试"); }
    await env.DB.prepare("INSERT INTO audit(orderId,action,createdAt) VALUES(?,'contact_buyer',?)").bind(id, Date.now()).run();
    return json({ ok: true });
  }
  if (path === "/api/admin/order-cost" && request.method === "POST") {
    const input = await body(request), id = str(input.id, 64), goodsNo = str(input.goodsNo, 30), supplierName = str(input.supplierName, 100);
    const cents = input.costCents;
    if (!/^G[0-9]{4,20}$/.test(goodsNo) || !supplierName || !Number.isSafeInteger(cents) || Number(cents) < 0 || Number(cents) > 100000000) throw new HttpError(400, "请填写货源商、商品编号及正确的实际成本");
    const order = await env.DB.prepare("SELECT status FROM orders WHERE id=?").bind(id).first<{status:string}>();
    if (!order || !["processing", "complete"].includes(order.status)) throw new HttpError(409, "请先核实收款");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO order_procurement_cost(orderId,goodsNo,supplierName,costCents,source,updatedAt) VALUES(?,?,?,?,'manual',?) ON CONFLICT(orderId) DO UPDATE SET goodsNo=excluded.goodsNo,supplierName=excluded.supplierName,costCents=excluded.costCents,source='manual',updatedAt=excluded.updatedAt").bind(id,goodsNo,supplierName,Number(cents),Date.now()),
      env.DB.prepare("INSERT INTO audit(orderId,action,createdAt) VALUES(?,'order_cost_manual',?)").bind(id,Date.now()),
    ]);
    return json({ok:true});
  }
  if (path === "/api/admin/catalog" && request.method === "GET") {
    const sales = await env.DB.prepare("SELECT product,title,supplierPlan,COUNT(*) AS sales FROM orders WHERE paidAt IS NOT NULL GROUP BY product,title,supplierPlan").all<{product:string;title:string;supplierPlan:string|null;sales:number}>();
    const products = [
      { key:"museWarranty", category: "Muse", title: `${accountTitle} · 7 天质保`, supplier: MUSE_ACCOUNT_SUPPLIER.goodsNo, sales: sales.results.filter(x => x.product === "muse" && x.supplierPlan === "museWarranty").reduce((n,x) => n + x.sales,0) },
      { key:"museBasic", category: "Muse", title: `${accountTitle} · 基础款`, supplier: MUSE_BASIC_SUPPLIER.goodsNo, sales: sales.results.filter(x => x.product === "muse" && x.supplierPlan !== "museWarranty").reduce((n,x) => n + x.sales,0) },
      ...tokenPlans.map(p => ({ key:`token:${p.label}`, category: "Muse Token", title: `Muse Token · ${p.label}`, supplier: "G85161614", sales: sales.results.filter(x => x.product === "muse-token" && x.title === `Muse Token · ${p.label}`).reduce((n,x) => n + x.sales,0) })),
      ...Object.entries(GPT_SUPPLIER_PRODUCTS).filter(([key]) => key !== "halfPriceAccount").map(([key,p]) => ({ key, category: "GPT", title: p.title, supplier: p.goodsNo, sales: sales.results.filter(x => x.product === "gpt" && x.supplierPlan === key).reduce((n,x) => n + x.sales,0) })),
    ];
    return json({ products });
  }
  if (path === "/api/admin/catalog-suppliers" && request.method === "POST") {
    const key = str((await body(request)).key, 80);
    let goods: readonly string[] = [], quantity = 1;
    if (key === "museWarranty") goods = [MUSE_ACCOUNT_SUPPLIER.goodsNo];
    else if (key === "museBasic") goods = [MUSE_BASIC_SUPPLIER.goodsNo];
    else if (key.startsWith("token:")) { const plan = tokenPlans.find(p => `token:${p.label}` === key); if (plan) { goods = ["G85161614"]; quantity = Number(plan.label.match(/^(\d+)/)?.[1]) / 10; } }
    else if (Object.hasOwn(GPT_SUPPLIER_PRODUCTS,key) && key !== "halfPriceAccount") { const plan = GPT_SUPPLIER_PRODUCTS[key as keyof typeof GPT_SUPPLIER_PRODUCTS]; goods = [plan.goodsNo, ...(SUPPLIER_BACKUPS[key] || [])]; }
    if (!goods.length || !Number.isInteger(quantity) || quantity < 1) throw new HttpError(400,"商品不存在");
    const names: Record<string,string> = {G95786160:"huaiyesu@gmail.com",G88655555:"lzz_ai小铺",G75777360:"原货源商（名称待核实）",G17614190:"AI源头",G37376813:"阿度AI账号批发",G43844575:"小白ai一手货源",G85161614:"海外批发"};
    const items = await Promise.all(goods.map(async (goodsNo,index) => {
      const entry = {goodsNo, name:names[goodsNo] || "名称待核实", priority:index === 0 ? "首选" : `备用 ${index}`, unitPrice:null as number|null, total:null as number|null, stock:null as number|null};
      if (!env.SUPPLIER_APP_ID || !env.SUPPLIER_SECRET) return entry;
      try { const result = await supplierRequest({appId:env.SUPPLIER_APP_ID,secret:env.SUPPLIER_SECRET},"purchase","quotePrice",{goods_no:goodsNo,quantity}) as {code:number;data?:{unit_price?:number;total_amount?:number;available_quantity?:number}}; if(result.code !== 1 || !result.data) return entry;
        const unit=result.data.unit_price, total=result.data.total_amount, stock=result.data.available_quantity;
        return {...entry,unitPrice:typeof unit === "number" && Number.isFinite(unit) && unit >= 0 ? unit : null,total:typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null,stock:typeof stock === "number" && Number.isFinite(stock) && stock >= 0 ? stock : null};
      } catch { return entry; }
    }));
    return json({quantity,items});
  }
  if (path === "/api/admin/email-bridge-match" && request.method === "POST") {
    const candidate = str((await body(request)).url, 500);
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(candidate)) throw new HttpError(400, "请粘贴完整的网页应用网址，网址应以 /exec 结尾");
    if (!env.GMAIL_SCRIPT_URL) throw new HttpError(503, "线上尚未配置邮件桥接地址");
    return json({matches: same(candidate, env.GMAIL_SCRIPT_URL.trim())});
  }
  if (path === "/api/admin/email-status" && request.method === "GET") {
    const [buyerDelivery, attachments] = await Promise.all([hasBuyerDelivery(env), hasAttachmentDelivery(env)]);
    return json({ configured: hasEmailConfig(env), buyerDelivery, attachments, provider: env.GMAIL_SCRIPT_URL && env.GMAIL_SCRIPT_TOKEN ? "gmail" : env.RESEND_API_KEY ? "resend" : "none" });
  }
  if (path === "/api/admin/email-test" && request.method === "POST") {
    if (!hasEmailConfig(env)) throw new HttpError(503, "邮件服务尚未配置");
    try { await sendEmail(env, `muse-email-test-${crypto.randomUUID()}`, "Muse 商店邮件提醒测试", "<p>邮件提醒已成功连接。新订单和买家付款反馈将自动发送到此邮箱。</p>", "邮件提醒已成功连接。新订单和买家付款反馈将自动发送到此邮箱。"); }
    catch { throw new HttpError(502, "邮件测试失败，请检查 Gmail 脚本部署地址和令牌，或 Resend API Key"); }
    return json({ ok: true });
  }
  if (path === "/api/admin/push-key" && request.method === "GET") {
    if (!env.PUSH_PUBLIC_KEY || !env.PUSH_PRIVATE_KEY) throw new HttpError(503, "手机推送尚未配置");
    return json({ publicKey: env.PUSH_PUBLIC_KEY });
  }
  if (path === "/api/admin/push-subscribe" && request.method === "POST") {
    if (!env.PUSH_PUBLIC_KEY || !env.PUSH_PRIVATE_KEY) throw new HttpError(503, "手机推送尚未配置");
    const subscription = pushSubscription((await body(request)).subscription);
    if (!subscription) throw new HttpError(400, "手机推送订阅无效");
    const existing = await env.DB.prepare("SELECT endpoint FROM push_subscriptions WHERE endpoint=?").bind(subscription.endpoint).first();
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM push_subscriptions").first<{ total: number }>();
    if (!existing && (count?.total || 0) >= 5) throw new HttpError(409, "已连接 5 台设备，请联系支持清理旧设备");
    await env.DB.prepare("INSERT INTO push_subscriptions(endpoint,subscription,createdAt) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription")
      .bind(subscription.endpoint, JSON.stringify(subscription), Date.now()).run();
    return json({ ok: true });
  }
  if (path === "/api/admin/push-test" && request.method === "POST") {
    await limit(env, request, "push-test", 10, 3600);
    const endpoint = str((await body(request)).endpoint, 2048);
    const row = await env.DB.prepare("SELECT subscription FROM push_subscriptions WHERE endpoint=?").bind(endpoint).first<{ subscription: string }>();
    if (!row) throw new HttpError(404, "这台手机尚未开启推送");
    try {
      const subscription = pushSubscription(JSON.parse(row.subscription));
      if (!subscription) throw new Error("invalid_subscription");
      const response = await deliverPush(env, subscription, "Muse 工作台测试提醒", "手机推送已连接，新订单会自动提醒。", `test:${Date.now()}`);
      if (!response.ok) throw new Error(`push_${response.status}`);
      return json({ ok: true });
    } catch { throw new HttpError(502, "测试推送未送达，请检查 iPhone 通知权限后重试"); }
  }
  if (path === "/api/admin/logout" && request.method === "POST") { await env.DB.prepare("DELETE FROM sessions WHERE hash=?").bind(await hash(adminSession(request))).run(); return json({ ok: true }, 200, { "Set-Cookie": cookieHeader(request, "", 0) }); }
  if (path === "/api/admin/orders" && request.method === "GET") {
    await expire(env);
    const url = new URL(request.url); const search = str(url.searchParams.get("q")); const status = str(url.searchParams.get("status"), 20); const page = Math.max(0, Math.min(100000, Number(url.searchParams.get("page")) || 0));
    const where = "WHERE (?='' OR code=? OR id=? OR target LIKE ? ESCAPE '\\') AND (?='' OR status=?)";
    const values = [search, search, search, `%${search.replace(/[\\%_]/g, "\\$&")}%`, status, status];
    const rows = await env.DB.prepare(`SELECT id,code,product,title,amountCents,target,contactEmail,method,status,createdAt,expiresAt,reportedAt,paidAt,completedAt,reference,updatedAt,(SELECT sentAt FROM delivery_emails WHERE orderId=orders.id) AS emailSentAt,(SELECT sendCount FROM delivery_emails WHERE orderId=orders.id) AS emailSendCount,(SELECT state FROM supplier_fulfillment WHERE orderId=orders.id) AS supplierState,(SELECT tradeNo FROM supplier_fulfillment WHERE orderId=orders.id) AS supplierTradeNo,(SELECT goodsNo FROM order_procurement_cost WHERE orderId=orders.id) AS costGoodsNo,(SELECT supplierName FROM order_procurement_cost WHERE orderId=orders.id) AS costSupplierName,(SELECT costCents FROM order_procurement_cost WHERE orderId=orders.id) AS costCents,(SELECT source FROM order_procurement_cost WHERE orderId=orders.id) AS costSource FROM orders ${where} ORDER BY createdAt DESC LIMIT 50 OFFSET ?`).bind(...values, page * 50).all();
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM orders ${where}`).bind(...values).first();
    const summary = await env.DB.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(status='reported'),0) AS awaiting, COALESCE(SUM(status='processing'),0) AS processing, COALESCE(SUM(status='complete'),0) AS completed, COALESCE(SUM(CASE WHEN paidAt IS NOT NULL THEN amountCents ELSE 0 END),0) AS revenueCents, COALESCE(SUM(CASE WHEN paidAt>=? THEN amountCents ELSE 0 END),0) AS todayCents FROM orders").bind(Math.floor((Date.now() + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000).first();
    return json({ orders: rows.results, count, summary, page });
  }
  if (path === "/api/admin/visits" && request.method === "GET") {
    const now = Date.now(), day = Math.floor((now + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
    const summary = await env.DB.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(createdAt>=?),0) AS today, COALESCE(SUM(createdAt>=?),0) AS last7Days FROM visits").bind(day, now - 7 * 86400000).first();
    const recent = await env.DB.prepare("SELECT id,page,source,device,createdAt FROM visits ORDER BY createdAt DESC LIMIT 50").all();
    return json({ summary, recent: recent.results });
  }
  if (path === "/api/admin/tutorial" && request.method === "GET") {
    const row = await env.DB.prepare("SELECT title,blocks,updatedAt FROM tutorials WHERE id='muse-account'").first<{ title: string; blocks: string; updatedAt: number }>();
    return json(row ? { title: row.title, blocks: JSON.parse(row.blocks), updatedAt: row.updatedAt } : { title: "Muse 成品账号使用教程", blocks: [], updatedAt: null });
  }
  if (path === "/api/admin/tutorial" && request.method === "POST") {
    const input = await body(request), title = str(input.title, 100), blocks = validateTutorial(input.blocks);
    if (!title) throw new HttpError(400, "请填写教程标题");
    const now = Date.now();
    await env.DB.prepare("INSERT INTO tutorials(id,title,blocks,updatedAt) VALUES('muse-account',?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,blocks=excluded.blocks,updatedAt=excluded.updatedAt")
      .bind(title, JSON.stringify(blocks), now).run();
    return json({ ok: true, title, blocks, updatedAt: now });
  }
  if (path === "/api/admin/tutorial-image" && request.method === "POST") {
    const mime = request.headers.get("Content-Type")?.split(";")[0].toLowerCase();
    if (!mime || !["image/png", "image/jpeg", "image/webp"].includes(mime)) throw new HttpError(415, "请上传 PNG、JPG 或 WebP 图片");
    const bytes = await readImage(request);
    const png = mime === "image/png" && bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b);
    const jpeg = mime === "image/jpeg" && bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = mime === "image/webp" && bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
    if (!(png || jpeg || webp)) throw new HttpError(400, "图片文件无效");
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM tutorial_images").first<{ total: number }>();
    if ((count?.total || 0) >= 100) throw new HttpError(409, "教程图片已达上限，请联系支持清理旧图片");
    let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO tutorial_images(id,mime,data,createdAt) VALUES(?,?,?,?)").bind(id, mime, btoa(binary), Date.now()).run();
    return json({ url: `https://musetoken.store/api/tutorial-images/${id}` }, 201);
  }
  if (path === "/api/admin/delivery-files" && request.method === "GET") {
    const orderId = str(new URL(request.url).searchParams.get("orderId"), 64);
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first<Row>();
    if (!order || !["muse", "gpt"].includes(order.product)) throw new HttpError(404, "订单不存在");
    const rows = await env.DB.prepare("SELECT id,name,mime,size,uploadedBytes FROM delivery_files WHERE orderId=? AND uploadedBytes=size ORDER BY createdAt").bind(orderId).all();
    const goods = order.product === "gpt" ? inventoryProducts(order).map(value => value.slice(4)) : [];
    return json({ files: rows.results, sources: goods.map(goodsNo => ({ goodsNo, instructions: goodsNo === "G95786160" ? newQualificationGuide : goodsNo === "G88655555" ? qualificationGuide : "" })) });
  }
  if (path === "/api/admin/delivery-file/start" && request.method === "POST") {
    const input = await body(request), orderId = str(input.orderId, 64), name = str(input.name, 120).replace(/[\\/\x00-\x1f]/g, "_");
    const mime = str(input.mime, 50), size = Number(input.size);
    if (!name || !fileTypes.has(mime) || !Number.isInteger(size) || size < 1 || size > maxFileBytes) throw new HttpError(400, "请选择 15 MB 以内的图片或视频");
    const order = await env.DB.prepare("SELECT product,status FROM orders WHERE id=?").bind(orderId).first<{ product: string; status: string }>();
    if (!order || !["muse", "gpt"].includes(order.product) || !["processing", "complete"].includes(order.status)) throw new HttpError(409, "请先核实收款");
    const quota = await env.DB.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS bytes FROM delivery_files WHERE orderId=?").bind(orderId).first<{ count: number; bytes: number }>();
    if ((quota?.count || 0) >= 4 || (quota?.bytes || 0) + size > maxMailBytes) throw new HttpError(413, "这笔订单的附件储存已满，请删除不用的附件");
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO delivery_files(id,orderId,name,mime,size,createdAt) VALUES(?,?,?,?,?,?)").bind(id, orderId, name, mime, size, Date.now()).run();
    return json({ id, chunkBytes }, 201);
  }
  const chunkMatch = path.match(/^\/api\/admin\/delivery-file\/([a-f0-9-]{36})\/(\d+)$/);
  if (chunkMatch && request.method === "POST") {
    const id = chunkMatch[1], part = Number(chunkMatch[2]);
    const file = await env.DB.prepare("SELECT * FROM delivery_files WHERE id=?").bind(id).first<DeliveryFile>();
    if (!file || !Number.isInteger(part) || part !== Math.floor(file.uploadedBytes / chunkBytes) || file.uploadedBytes >= file.size) throw new HttpError(409, "附件上传顺序错误，请重新选择文件");
    const bytes = await readFileChunk(request);
    if (bytes.length !== Math.min(chunkBytes, file.size - file.uploadedBytes)) throw new HttpError(400, "附件分片长度错误");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO delivery_file_chunks(fileId,part,data) VALUES(?,?,?)").bind(id, part, base64(bytes)),
      env.DB.prepare("UPDATE delivery_files SET uploadedBytes=uploadedBytes+? WHERE id=? AND uploadedBytes=?").bind(bytes.length, id, file.uploadedBytes),
    ]);
    return json({ ok: true, uploadedBytes: file.uploadedBytes + bytes.length });
  }
  if (path === "/api/admin/delivery-file/remove" && request.method === "POST") {
    const id = str((await body(request)).id, 64);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM delivery_file_chunks WHERE fileId=?").bind(id),
      env.DB.prepare("DELETE FROM delivery_files WHERE id=?").bind(id),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/admin/inventory" && request.method === "GET") {
    const count = await env.DB.prepare("SELECT COUNT(*) AS available FROM inventory_cards WHERE product='muse-7day' AND orderId IS NULL").first<{ available: number }>();
    const basic = await env.DB.prepare("SELECT COUNT(*) AS available FROM inventory_cards WHERE product='muse-basic-43844575' AND orderId IS NULL").first<{ available: number }>();
    const groups=await env.DB.prepare("SELECT product,COUNT(*) AS available FROM inventory_cards WHERE orderId IS NULL AND (product LIKE 'gpt:G%' OR product LIKE 'unlinked:G%') GROUP BY product ORDER BY product").all();
    return json({ available: count?.available || 0, basicAvailable: basic?.available || 0, gpt:groups.results });
  }
  if (path === "/api/admin/inventory-import" && request.method === "POST") {
    const tradeNo = str((await body(request)).tradeNo, 128);
    if (!tradeNo) throw new HttpError(400, "请填写 16688 采购订单编号");
    if (!env.SUPPLIER_APP_ID || !env.SUPPLIER_SECRET) throw new HttpError(503, "货源接口尚未配置");
    const existing = await env.DB.prepare("SELECT orderId FROM supplier_fulfillment WHERE tradeNo=?").bind(tradeNo).first();
    if (existing) throw new HttpError(409, "这笔采购已关联商店订单，不能作为库存导入");
    let result: { code: number; data?: Record<string, unknown> };
    try { result = await supplierRequest({ appId: env.SUPPLIER_APP_ID, secret: env.SUPPLIER_SECRET }, "purchase", "query", { trade_no: tradeNo }) as typeof result; }
    catch { throw new HttpError(502, "查询采购订单失败，请稍后重试"); }
    const data = result.data;
    if (result.code !== 1 || !data || ![4, 5].includes(Number(data.status))) throw new HttpError(409, "采购订单尚未发货或无法查询");
    const goodsNo=String(data.goods_no || "");
    const gptGoods=new Set<string>([...Object.values(GPT_SUPPLIER_PRODUCTS).map(p=>p.goodsNo),...Object.values(SUPPLIER_BACKUPS).flat()]);
    if (!/^G\d+$/.test(goodsNo)) throw new HttpError(400,"采购单未返回有效商品编号，请核查。");
    const product=goodsNo===MUSE_ACCOUNT_SUPPLIER.goodsNo ? "muse-7day" : goodsNo===MUSE_BASIC_SUPPLIER.goodsNo ? "muse-basic-43844575" : gptGoods.has(goodsNo) ? `gpt:${goodsNo}` : `unlinked:${goodsNo}`;
    const cards = Array.isArray(data.cards) ? data.cards : [];
    const unique = [...new Set(cards.map(value => typeof value === "object" && value !== null && "code" in value ? str(value.code, 4000) : "").filter(Boolean))];
    if (!unique.length) throw new HttpError(409, "采购订单未返回卡密");
    let added = 0;
    for (const card of unique) {
      const used = await env.DB.prepare("SELECT orderId FROM supplier_fulfillment WHERE card=? LIMIT 1").bind(card).first();
      if (used) continue;
      const rawInstruction=typeof data.instruction === "string" ? data.instruction.trim() : "";
      const instructions=goodsNo === "G95786160" ? newQualificationGuide : goodsNo === "G88655555" ? qualificationGuide : goodsNo === "G17614190" ? [halfPriceTopupGuide,rawInstruction || "（兑换说明未提供）"].join("\n\n") : rawInstruction;
      const saved = await env.DB.prepare("INSERT OR IGNORE INTO inventory_cards(id,product,card,cardHash,tradeNo,instruction,createdAt) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(), product, card, await hash(card), tradeNo, instructions, Date.now()).run();
      added += saved.meta.changes;
    }
    return json({ added, skipped: unique.length - added, goodsNo, linked:!product.startsWith("unlinked:") });
  }
  if (path === "/api/admin/delivery-history" && request.method === "GET") {
    const id = str(new URL(request.url).searchParams.get("orderId"), 64);
    const rows = await env.DB.prepare("SELECT text,state,createdAt FROM delivery_history WHERE orderId=? ORDER BY createdAt DESC LIMIT 20").bind(id).all();
    const old = rows.results.length ? null : await env.DB.prepare("SELECT card,instruction,state,tradeNo FROM supplier_fulfillment WHERE orderId=? AND card IS NOT NULL").bind(id).first();
    return json({ history: rows.results, legacy: old });
  }
  if ((path === "/api/admin/token-quote" || path === "/api/admin/token-purchase") && request.method === "POST") {
    const input = await body(request), id = str(input.id, 64);
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first<Row>();
    if (!order || order.product !== "muse-token") throw new HttpError(404, "未找到 Token 订单");
    if (order.status !== "processing") throw new HttpError(409, "请先核实收款，订单须为待交付状态");
    const match = order.title.match(/^Muse Token · (100|150|200|300)亿 Token$/);
    if (!match) throw new HttpError(409, "无法确认该订单的充值档位，请人工核查");
    const quantity = Number(match[1]) / 10;
    if (!env.SUPPLIER_APP_ID || !env.SUPPLIER_SECRET) throw new HttpError(503, "货源接口尚未配置");
    const creds = { appId: env.SUPPLIER_APP_ID, secret: env.SUPPLIER_SECRET };
    type Result = { code: number; data?: Record<string, unknown> };
    let task = await env.DB.prepare("SELECT state,tradeNo,card FROM supplier_fulfillment WHERE orderId=?").bind(id).first<{state:string;tradeNo:string|null;card:string|null}>();
    if (path.endsWith("token-quote") && task) return json({ quantity, state: task.state, tradeNo: task.tradeNo });
    if (!task) {
      let quote: Result;
      try { quote = await supplierRequest(creds, "purchase", "quotePrice", {goods_no:"G85161614",quantity}) as Result; } catch { throw new HttpError(502, "货源询价失败，未采购"); }
      const total = Number(quote.data?.total_amount), available = quote.data?.available_quantity;
      if (quote.code !== 1 || !Number.isFinite(total) || total <= 0) throw new HttpError(409, "货源询价失败，未采购；请确认已代理该货源");
      if (path.endsWith("token-quote")) return json({quantity,total,stock:available,balanceEnough:quote.data?.balance_enough === true});
      if (!Number.isSafeInteger(input.expectedCents) || input.expectedCents !== Math.round(total * 100)) throw new HttpError(409, "采购报价已变化，请关闭窗口重新询价");
      if (typeof available === "number" && available < quantity) throw new HttpError(409, "货源库存不足，未采购");
      if (quote.data?.balance_enough !== true) throw new HttpError(409, `运营钱包余额不足，采购需 ¥${total.toFixed(2)}，未采购`);
      if (Math.round(total * 100) > order.amountCents) throw new HttpError(409, "采购成本高于订单售价，未采购");
      const claim = await env.DB.prepare("INSERT OR IGNORE INTO supplier_fulfillment(orderId,state,updatedAt) SELECT ?,'purchasing',? WHERE EXISTS (SELECT 1 FROM orders WHERE id=? AND status='processing')").bind(id,Date.now(),id).run();
      if (!claim.meta.changes) throw new HttpError(409, "订单已有采购操作，请刷新查看，勿重复采购");
      let purchase: Result;
      try { purchase = await supplierRequest(creds,"purchase","create",{goods_no:"G85161614",quantity,remark:`订单码:${order.code} 平台订单:${id}`}) as Result; }
      catch { await env.DB.prepare("UPDATE supplier_fulfillment SET state='purchase_unknown',updatedAt=? WHERE orderId=?").bind(Date.now(),id).run(); throw new HttpError(502, "采购结果不明，请核查 16688，勿重复采购"); }
      if (purchase.code !== 1 || typeof purchase.data?.trade_no !== "string" || !purchase.data.trade_no.trim()) { await env.DB.prepare("UPDATE supplier_fulfillment SET state='purchase_unknown',updatedAt=? WHERE orderId=?").bind(Date.now(),id).run(); throw new HttpError(502, "采购未确认，请核查 16688，勿重复采购"); }
      const actual = Number(purchase.data.total_amount);
      await env.DB.batch([
        env.DB.prepare("UPDATE supplier_fulfillment SET state='awaiting',tradeNo=?,updatedAt=? WHERE orderId=?").bind(purchase.data.trade_no,Date.now(),id),
        env.DB.prepare("INSERT OR IGNORE INTO order_procurement_cost(orderId,goodsNo,supplierName,costCents,source,updatedAt) VALUES(?,'G85161614','16688 货源',?,'supplier',?)").bind(id,Number.isFinite(actual) && actual > 0 ? Math.round(actual*100) : null,Date.now()),
      ]);
      task = {state:"awaiting",tradeNo:purchase.data.trade_no,card:null};
    }
    if (task.state === "awaiting" && task.tradeNo) {
      let result: Result; try { result = await supplierRequest(creds,"purchase","query",{trade_no:task.tradeNo}) as Result; } catch { throw new HttpError(502,"查询采购结果失败，可稍后重试，不会重复采购"); }
      if (result.code !== 1 || !result.data || ![4,5].includes(Number(result.data.status))) throw new HttpError(409,"货源尚未发货，可稍后重试查询");
      const actualCost = Number(result.data.total_amount);
      if (Number.isFinite(actualCost) && actualCost > 0) await env.DB.prepare("UPDATE order_procurement_cost SET costCents=?,updatedAt=? WHERE orderId=? AND source='supplier' AND costCents IS NULL").bind(Math.round(actualCost*100),Date.now(),id).run();
      const cards = Array.isArray(result.data.cards) ? result.data.cards.map(x => x && typeof x === "object" && "code" in x ? String(x.code) : "").filter(Boolean) : [];
      if (cards.length !== quantity || new Set(cards).size !== quantity) throw new HttpError(409, `货源返回 ${cards.length} 件，需 ${quantity} 件且不能重复；请核查采购单`);
      await env.DB.prepare("UPDATE supplier_fulfillment SET state='ready',card=?,instruction=?,updatedAt=? WHERE orderId=? AND state='awaiting'").bind(cards.join("\n"),typeof result.data.instruction === "string" ? result.data.instruction : "",Date.now(),id).run();
      task = { ...task, state:"ready",card:cards.join("\n") };
    }
    if (task.state !== "ready" || !task.card) throw new HttpError(409,"采购正在处理或结果待核查，请勿重复采购");
    return json({quantity,tradeNo:task.tradeNo,card:task.card});
  }
  if (path === "/api/admin/supplier-check" && request.method === "POST") {
    const input = await body(request);
    if (typeof input.planId !== "string" || (input.planId !== "museAccount" && !Object.hasOwn(GPT_SUPPLIER_PRODUCTS, input.planId))) throw new HttpError(400, "商品不存在");
    if (!env.SUPPLIER_APP_ID || !env.SUPPLIER_SECRET) throw new HttpError(503, "16688 接口凭证尚未配置");
    const plan = input.planId === "museAccount" ? MUSE_ACCOUNT_SUPPLIER : GPT_SUPPLIER_PRODUCTS[input.planId as keyof typeof GPT_SUPPLIER_PRODUCTS];
    try {
      const result = await supplierRequest({ appId: env.SUPPLIER_APP_ID, secret: env.SUPPLIER_SECRET }, "purchase", "quotePrice", { goods_no: plan.goodsNo, quantity: 1 }) as { code: number; data?: { total_amount?: number; unit_price?: number; fee?: number; balance_enough?: boolean; available_quantity?: number } };
      if (result.code !== 1 || !result.data) throw new Error("supplier_quote_failed");
      return json({ total: result.data.total_amount, unitPrice: result.data.unit_price, fee: result.data.fee, balanceEnough: result.data.balance_enough, stock: result.data.available_quantity });
    } catch { throw new HttpError(502, "货源询价失败，请检查接口配置"); }
  }
  if (path === "/api/admin/supplier-preview" && request.method === "POST") {
    const input=await body(request), order=await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(str(input.id,64)).first<Row>();
    if (!order || !["gpt","muse"].includes(order.product) || order.status !== "processing") throw new HttpError(409,"请先核实收款并选择订单。");
    if (!env.SUPPLIER_APP_ID || !env.SUPPLIER_SECRET) throw new HttpError(503,"货源接口凭证尚未配置");
    if (await env.DB.prepare("SELECT orderId FROM supplier_fulfillment WHERE orderId=?").bind(order.id).first()) throw new HttpError(409,"已有采购记录，请刷新订单后继续查询。");
    const products=inventoryProducts(order);
    for (const product of (order.supplierPlan === "halfPriceAccountOneMonth" ? products.filter(p => p === "gpt:G95786160") : products)) { const item=await env.DB.prepare("SELECT id,product FROM inventory_cards WHERE product=? AND orderId IS NULL LIMIT 1").bind(product).first<{product:string}>(); if (item) return json({inventory:true,goodsNo:item.product.startsWith("gpt:") ? item.product.slice(4) : ""},200,{"Cache-Control":"no-store"}); }
    const plan=order.product === "muse" ? (order.supplierPlan === "museWarranty" ? MUSE_ACCOUNT_SUPPLIER : MUSE_BASIC_SUPPLIER) : GPT_SUPPLIER_PRODUCTS[order.supplierPlan as keyof typeof GPT_SUPPLIER_PRODUCTS]; if (!plan) throw new HttpError(400,"商品货源尚未配置");
    return json(await chooseSupplier(env,order,plan.goodsNo),200,{"Cache-Control":"no-store"});
  }
  if (path === "/api/admin/supplier-deliver" && request.method === "POST") {
    const input = await body(request), id = str(input.id, 64);
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first<Row>();
    if (!order || !["gpt", "muse"].includes(order.product)) throw new HttpError(404, "未找到可采购的订单");
    if (order.status !== "processing") throw new HttpError(409, "请先核实收款，且订单须为待交付状态");
    const plan = order.product === "muse" ? (order.supplierPlan === "museWarranty" ? MUSE_ACCOUNT_SUPPLIER : MUSE_BASIC_SUPPLIER) : GPT_SUPPLIER_PRODUCTS[order.supplierPlan as keyof typeof GPT_SUPPLIER_PRODUCTS];
    if (!plan) throw new HttpError(400, "商品货源尚未配置");
    if (!env.SUPPLIER_APP_ID || !env.SUPPLIER_SECRET) throw new HttpError(503, "16688 接口凭证尚未配置");
    if (!hasEmailConfig(env) || !await hasBuyerDelivery(env)) throw new HttpError(503, "买家邮件服务尚未启用");
    const creds = { appId: env.SUPPLIER_APP_ID, secret: env.SUPPLIER_SECRET };
    type SupplierResult = { code: number; msg?: string; data?: Record<string, unknown> };
    let task = await env.DB.prepare("SELECT state,tradeNo,card,instruction FROM supplier_fulfillment WHERE orderId=?").bind(id).first<{ state: string; tradeNo: string | null; card: string | null; instruction: string | null }>();
    if (!task) {
      for (const product of (order.supplierPlan === "halfPriceAccountOneMonth" ? inventoryProducts(order).filter(p => p === "gpt:G95786160") : inventoryProducts(order))) {
        await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO supplier_fulfillment(orderId,state,tradeNo,card,instruction,inventoryId,updatedAt) SELECT ?,'ready',tradeNo,card,instruction,id,? FROM inventory_cards WHERE product=? AND orderId IS NULL AND NOT EXISTS (SELECT 1 FROM delivery_emails WHERE orderId=?) ORDER BY createdAt,id LIMIT 1").bind(id, Date.now(), product, id),
        env.DB.prepare("UPDATE inventory_cards SET orderId=? WHERE id=(SELECT inventoryId FROM supplier_fulfillment WHERE orderId=?) AND orderId IS NULL").bind(id, id),
      ]);
      task = await env.DB.prepare("SELECT state,tradeNo,card,instruction FROM supplier_fulfillment WHERE orderId=?").bind(id).first<{ state: string; tradeNo: string | null; card: string | null; instruction: string | null }>();
      if (task) break;
      }
    }
    if (!task) {
      if (input.expectedInventory === true) throw new HttpError(409,"库存已变化，请重新确认后再发货；未执行采购。");
      let selected: Awaited<ReturnType<typeof chooseSupplier>>;
      try { selected=await chooseSupplier(env,order,plan.goodsNo); }
      catch(error) { if (error instanceof HttpError && error.message.includes("均缺货")) await env.DB.prepare("UPDATE orders SET stockIssue=1,updatedAt=? WHERE id=? AND status='processing'").bind(Date.now(),id).run(); throw error; }
      if (input.expectedGoodsNo !== undefined && (input.expectedGoodsNo !== selected.goodsNo || input.expectedCents !== Math.round(selected.total*100))) throw new HttpError(409,"货源或价格已变化，请重新询价确认，未执行采购。");
      const claimed = await env.DB.prepare("INSERT OR IGNORE INTO supplier_fulfillment(orderId,state,instruction,updatedAt) SELECT ?,'purchasing',?,? WHERE NOT EXISTS (SELECT 1 FROM delivery_emails WHERE orderId=?)").bind(id, `source:${selected.goodsNo}`, Date.now(), id).run();
      if (!claimed.meta.changes) throw new HttpError(409, "该订单已有发货操作，请先核查订单和邮件");
      await env.DB.prepare("UPDATE orders SET stockIssue=0 WHERE id=?").bind(id).run();
      let purchase: SupplierResult;
      try { purchase = await supplierRequest(creds, "purchase", "create", { goods_no: selected.goodsNo, quantity: 1, remark: `订单码:${order.code} 平台订单:${order.id}` }) as SupplierResult; }
      catch { await env.DB.prepare("UPDATE supplier_fulfillment SET state='purchase_unknown',updatedAt=? WHERE orderId=?").bind(Date.now(), id).run(); throw new HttpError(502, "采购结果不明，请先在 16688 核查采购记录，勿重复采购"); }
      if (purchase.code !== 1 || !purchase.data || typeof purchase.data.trade_no !== "string") {
        await env.DB.prepare("UPDATE supplier_fulfillment SET state='purchase_unknown',updatedAt=? WHERE orderId=?").bind(Date.now(), id).run();
        throw new HttpError(502, "采购未确认，请先核查 16688 采购记录");
      }
      const actual = Number(purchase.data.total_amount);
      await env.DB.batch([
        env.DB.prepare("UPDATE supplier_fulfillment SET state='awaiting',tradeNo=?,updatedAt=? WHERE orderId=?").bind(purchase.data.trade_no,Date.now(),id),
        env.DB.prepare("INSERT OR IGNORE INTO order_procurement_cost(orderId,goodsNo,supplierName,costCents,source,updatedAt) VALUES(?,?,?,?, 'supplier',?)").bind(id,selected.goodsNo,selected.supplierName,Number.isFinite(actual) && actual > 0 ? Math.round(actual*100) : null,Date.now()),
      ]);
      task = { state: "awaiting", tradeNo: purchase.data.trade_no, card: null, instruction: `source:${selected.goodsNo}` };
    }
    if (task.state === "awaiting" && task.tradeNo) {
      let result: SupplierResult;
      try { result = await supplierRequest(creds, "purchase", "query", { trade_no: task.tradeNo }) as SupplierResult; }
      catch { throw new HttpError(502, "采购订单查询失败，请稍后重新点击发货，不会重复采购"); }
      if (result.code !== 1 || !result.data || ![4, 5].includes(Number(result.data.status))) throw new HttpError(409, "货源尚未发货，请稍后重新点击发货");
      const actualCost = Number(result.data.total_amount);
      if (Number.isFinite(actualCost) && actualCost > 0) await env.DB.prepare("UPDATE order_procurement_cost SET costCents=?,updatedAt=? WHERE orderId=? AND source='supplier' AND costCents IS NULL").bind(Math.round(actualCost*100),Date.now(),id).run();
      const cards = Array.isArray(result.data.cards) ? result.data.cards : [];
      const card = cards.map(value => typeof value === "object" && value !== null && "code" in value ? String(value.code) : "").filter(Boolean).join("\n");
      if (!card) throw new HttpError(409, "货源未返回卡密，请核查采购订单");
      const fallback = order.product === "muse" ? "请使用美国 IP 登录 Muse，通过验证码获取地址查看验证码；账号自带 10 亿 Token。请检查首次登录并换绑自己的邮箱。" : order.supplierPlan === "plus15Day" ? "请输入账号及密码登录，将 2FA 密钥输入 https://2fa.fun/ 或 https://2fa.live/ 获取验证码。供货商提供 15 天质保，请勿换绑、修改密码或 2FA，否则不再提供质保。" : order.supplierPlan === "plusAccount" ? "请在购买后 20 分钟内完成兑换并检查首次登录。验证码获取地址：https://2fa.vip/。售后规则请联系货源商确认。" : order.supplierPlan === "halfPriceAccount" || order.supplierPlan === "halfPriceAccountOneMonth" ? `账号资料格式：账号、密码和 2FA。验证码获取地址：https://2fa.run/（备用：https://2fa.fun/）。该账号包含${order.supplierPlan === "halfPriceAccount" ? "两个月" : "一个月"}半价资格，不包含 Plus 订阅。` : "请访问 https://shuwang.space/ ，使用收到的卡密按网站说明自行充值；发货并不代表充值已经完成。";
      const recordedSource=task.instruction?.match(/^source:(G\d+)$/)?.[1] || "";
      const queriedSource=typeof result.data.goods_no === "string" ? result.data.goods_no : "";
      if (recordedSource && queriedSource && recordedSource !== queriedSource) throw new HttpError(409,"货源编号与采购记录不一致，请核查后再发货。");
      const goodsNo=queriedSource || recordedSource;
      if (["halfPriceAccountOneMonth","halfPriceTopup"].includes(order.supplierPlan || "") && !goodsNo) throw new HttpError(409,"无法确认这笔采购的货源编号，请核查后再发货。");
      const rawInstruction=typeof result.data.instruction === "string" ? result.data.instruction.trim() : "";
      if (goodsNo === "G17614190" && !rawInstruction) throw new HttpError(409,"新货源未返回兑换说明，已采购，请核查教程后再发货，勿重复采购。");
      const instruction = goodsNo === "G95786160" ? newQualificationGuide : goodsNo === "G88655555" ? qualificationGuide : goodsNo === "G17614190" ? [halfPriceTopupGuide,rawInstruction].filter(Boolean).join("\n\n") : rawInstruction || fallback;
      const saved = await env.DB.prepare("UPDATE supplier_fulfillment SET state='ready',card=?,instruction=?,updatedAt=? WHERE orderId=? AND state='awaiting'").bind(card, instruction, Date.now(), id).run();
      if (!saved.meta.changes) throw new HttpError(409, "订单正在处理，请刷新");
      task = { ...task, state: "ready", card, instruction };
    }
    if (task.state !== "ready" || !task.card) throw new HttpError(409, "该订单正在处理或结果待核查，请查看货源及邮件记录，勿重复采购");
    if (task.instruction?.includes("（兑换说明未提供）")) throw new HttpError(409,"库存卡密缺少兑换说明，请核查教程后再发货，勿重复采购。");
    const needsSupplierSupport = order.supplierPlan === "plusAccount" || order.supplierPlan === "plus15Day";
    if (needsSupplierSupport && !task.tradeNo?.trim()) throw new HttpError(409, "缺少源头订单编号，请核查采购记录后再发货");
    const claim = await env.DB.prepare("UPDATE supplier_fulfillment SET state='sending',updatedAt=? WHERE orderId=? AND state='ready'").bind(Date.now(), id).run();
    if (!claim.meta.changes) throw new HttpError(409, "邮件正在发送，请刷新订单");
    const loginGuide = order.supplierPlan === "plus15Day" ? "登录步骤：\n1. 打开 ChatGPT 登录页面，输入邮件中的账号和密码。\n2. 将邮件中的 2FA 密钥输入 https://2fa.fun/ 或 https://2fa.live/，获取一次性验证码。\n3. 在登录页面输入验证码。请勿换绑、修改密码或 2FA，否则供货商不再提供质保。" : "";
    const { html, text } = deliveryEmail({ title: order.title, code: order.code, card: task.card, instructions: [loginGuide, task.instruction || "", order.product === "muse" ? (order.supplierPlan === "museWarranty" ? "7 天内封号，可以免费换号；请在 8 小时内首次登录验证。" : "本商品不含 7 天质保；首次登录保障期限请联系支持确认。") : ""].filter(Boolean).join("\n\n"), supplierOrderNo: needsSupplierSupport ? task.tradeNo! : undefined });
    const historyId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO delivery_history(id,orderId,text,state,createdAt) VALUES(?,?,?,'sending',?)").bind(historyId, id, text, Date.now()).run();
    try { await sendEmail(env, `supplier-delivery:${id}`, `${order.title} · 订单 ${order.code}`, html, text, order.target, [], "buyer_delivery"); }
    catch { await env.DB.prepare("UPDATE delivery_history SET state='unknown' WHERE id=?").bind(historyId).run(); await env.DB.prepare("UPDATE supplier_fulfillment SET state='mail_unknown',updatedAt=? WHERE orderId=?").bind(Date.now(), id).run(); throw new HttpError(502, "邮件发送结果不明，请先核查发件箱和客户邮箱；卡密已采购，请勿重复采购"); }
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("UPDATE delivery_history SET state='sent' WHERE id=?").bind(historyId),
      env.DB.prepare("UPDATE supplier_fulfillment SET state='sent',updatedAt=? WHERE orderId=? AND state='sending'").bind(now, id),
      env.DB.prepare("UPDATE orders SET status='complete',completedAt=?,delivery=?,updatedAt=? WHERE id=? AND status='processing'").bind(now, JSON.stringify({ method: "email", sentAt: now }), now, id),
      env.DB.prepare("INSERT INTO audit(orderId,action,createdAt) VALUES(?,'supplier_delivery',?)").bind(id, now),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/admin/send-delivery" && request.method === "POST") {
    const input = await body(request), id = str(input.id, 64), card = str(input.card, 4000);
    if (!card) throw new HttpError(400, "请粘贴卡密内容");
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first<Row>();
    if (!order || !["muse", "gpt"].includes(order.product)) throw new HttpError(404, "未找到可邮件交付的订单");
    if (!["processing", "complete"].includes(order.status)) throw new HttpError(409, "请先核实收款");
    let instructions = "";
    if (order.product === "gpt") {
      const goodsNo = str(input.goodsNo, 30);
      if (!inventoryProducts(order).includes(`gpt:${goodsNo}`)) throw new HttpError(400, "请选择此商品对应的实际采购货源");
      instructions = goodsNo === "G95786160" ? newQualificationGuide : goodsNo === "G88655555" ? qualificationGuide : str(input.instructions, 2000);
      if (!instructions) throw new HttpError(400, "请填写该货源的使用或兑换说明，不能使用其他商品的教程");
    }
    if (!hasEmailConfig(env)) throw new HttpError(503, "邮件服务尚未配置");
    const ids = input.fileIds ?? [];
    if (!Array.isArray(ids) || ids.length > 4 || ids.some(value => typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value)) || new Set(ids).size !== ids.length) throw new HttpError(400, "附件选择无效");
    const files: DeliveryFile[] = [];
    for (const fileId of ids) {
      const file = await env.DB.prepare("SELECT * FROM delivery_files WHERE id=? AND orderId=?").bind(fileId, order.id).first<DeliveryFile>();
      if (!file || file.uploadedBytes !== file.size) throw new HttpError(400, "附件尚未上传完成");
      files.push(file);
    }
    if (files.reduce((sum, file) => sum + file.size, 0) > maxMailBytes) throw new HttpError(413, "单封邮件附件合计不能超过 20 MB");
    if (files.length && !await hasAttachmentDelivery(env)) throw new HttpError(503, "请先更新 Google 邮件脚本，才能发送附件");
    const tutorial = order.product !== "muse" || input.includeTutorial === false ? null : await env.DB.prepare("SELECT title,blocks FROM tutorials WHERE id='muse-account'").first<{ title: string; blocks: string }>();
    const blocks = tutorial ? validateTutorial(JSON.parse(tutorial.blocks)) : [];
    const tutorialHtml = blocks.map(block => block.type === "text"
      ? `<p style="white-space:pre-wrap">${escapeHtml(block.content)}</p>`
      : `<figure style="margin:18px 0"><img src="${block.url}" alt="${escapeHtml(block.caption || "教程图片")}" style="max-width:100%;height:auto;border-radius:8px"><figcaption>${escapeHtml(block.caption)}</figcaption></figure>`).join("");
    const tutorialText = blocks.map(block => block.type === "text" ? block.content : `${block.caption || "教程图片"}：${block.url}`).join("\n\n");
    const { html, text } = deliveryEmail({ title: order.title, code: order.code, card, instructions, extraHtml: tutorial && blocks.length ? `<h3>${escapeHtml(tutorial.title)}</h3>${tutorialHtml}` : "", extraText: tutorial && blocks.length ? `${tutorial.title}\n${tutorialText}` : "" });
    const previous = await env.DB.prepare("SELECT status FROM delivery_emails WHERE orderId=?").bind(order.id).first<{ status: string }>();
    const claimed = previous
      ? await env.DB.prepare("UPDATE delivery_emails SET status='sending' WHERE orderId=? AND status='sent'").bind(order.id).run()
      : await env.DB.prepare("INSERT OR IGNORE INTO delivery_emails(orderId,status,createdAt) SELECT ?,'sending',? WHERE NOT EXISTS (SELECT 1 FROM supplier_fulfillment WHERE orderId=?)").bind(order.id, Date.now(), order.id).run();
    if (!claimed.meta.changes) throw new HttpError(409, "已有采购、发货或待核查记录，请先核查订单和发件箱，勿重复发货");
    const historyId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO delivery_history(id,orderId,text,state,createdAt) VALUES(?,?,?,'sending',?)").bind(historyId, order.id, text, Date.now()).run();
    try { await sendEmail(env, `delivery:${order.id}:${crypto.randomUUID()}`, `${order.title} · 订单 ${order.code}`, html, text, order.target, files, "buyer_delivery"); }
    catch {
      await env.DB.prepare("UPDATE delivery_history SET state='unknown' WHERE id=?").bind(historyId).run();
      await env.DB.prepare("UPDATE delivery_emails SET status='unknown' WHERE orderId=? AND status='sending'").bind(order.id).run();
      throw new HttpError(502, "发送结果未确认，已暂停重复发货。请先核查发件箱和客户收件情况");
    }
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("UPDATE delivery_history SET state='sent' WHERE id=?").bind(historyId),
      env.DB.prepare("UPDATE delivery_emails SET status='sent',sentAt=?,sendCount=sendCount+1 WHERE orderId=? AND status='sending'").bind(now, order.id),
      env.DB.prepare("UPDATE orders SET status='complete',completedAt=COALESCE(completedAt,?),delivery=?,updatedAt=? WHERE id=? AND status IN ('processing','complete')").bind(now, JSON.stringify({ method: "email", sentAt: now }), now, order.id),
      env.DB.prepare("INSERT INTO audit(orderId,action,createdAt) VALUES(?,?,?)").bind(order.id, previous ? "email_redelivery" : "email_delivery", now),
    ]);
    return json({ ok: true, sentAt: now, to: order.target, resent: Boolean(previous) });
  }
  if (path === "/api/admin/confirm-external-delivery" && request.method === "POST") {
    const input = await body(request), id = str(input.id, 64), note = str(input.note, 500);
    if (input.checked !== true || note.length < 6) throw new HttpError(400, "请确认客户已收到交付内容，并填写至少 6 字的核查备注");
    const now = Date.now();
    // Share the same order-level lock as manual mail and supplier purchasing.
    const result = await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO delivery_emails(orderId,status,createdAt) SELECT id,'external',? FROM orders WHERE id=? AND product='gpt' AND status='processing' AND paidAt IS NOT NULL AND NOT EXISTS (SELECT 1 FROM supplier_fulfillment WHERE orderId=orders.id) AND NOT EXISTS (SELECT 1 FROM delivery_history WHERE orderId=orders.id AND state IN ('sending','unknown'))").bind(now, id),
      env.DB.prepare("UPDATE orders SET status='complete',completedAt=?,delivery=?,stockIssue=0,updatedAt=? WHERE id=? AND status='processing' AND changes()=1").bind(now, JSON.stringify({ method: "manual", confirmedAt: now }), now, id),
      env.DB.prepare("INSERT INTO audit(orderId,action,createdAt) SELECT ?,'external_delivery_confirmed',? WHERE changes()=1").bind(id, now),
      env.DB.prepare("INSERT INTO delivery_history(id,orderId,text,state,createdAt) SELECT ?,?,?,'confirmed',? WHERE changes()=1").bind(crypto.randomUUID(), id, `店主确认已通过邮件交付。核查备注：${note}`, now),
    ]);
    if (!result[1].meta.changes) throw new HttpError(409, "订单须已核实收款且待交付；已有采购或发货记录时请先核查，不能重复确认");
    return json({ ok: true });
  }
  if (path === "/api/admin/update" && request.method === "POST") {
    const input = await body(request); const row = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(str(input.id, 64)).first<Row>();
    if (!row) throw new HttpError(404, "订单不存在");
    const now = Date.now(); let sql: string; let args: (string | number | null)[];
    if (input.action === "confirm") {
      if (!["pending", "reported", "expired"].includes(row.status)) throw new HttpError(409, "订单状态已更新，请刷新");
      const reference = input.reference ? str(input.reference, 100) : null; if (reference && reference.length < 6) throw new HttpError(400, "支付交易单号格式不正确");
      sql = "UPDATE orders SET status='processing',paidAt=?,reference=?,updatedAt=? WHERE id=? AND status=?"; args = [now, reference, now, row.id, row.status];
    } else if (input.action === "complete") {
      if (row.status !== "processing") throw new HttpError(409, "请先核对并确认收款");
      if (row.product === "gpt") throw new HttpError(409, "GPT 订单请使用采购并发邮件按钮");
      if (row.product === "muse-token") { const task = await env.DB.prepare("SELECT state FROM supplier_fulfillment WHERE orderId=?").bind(row.id).first<{state:string}>(); if (task && task.state !== "ready") throw new HttpError(409, "采购结果待核查，请先核查采购状态"); }
      let delivery: string | null = null;
      if (row.product === "muse") { const d = input.delivery as Record<string, unknown> | undefined; const email = str(d?.email, 254), password = str(d?.password, 256), codeUrl = str(d?.codeUrl, 1000); if (!email || !password || !/^https:\/\//.test(codeUrl)) throw new HttpError(400, "请填写交付账号、密码和 HTTPS 接码链接"); delivery = JSON.stringify({ email, password, codeUrl }); }
      if (input.checked !== true) throw new HttpError(400, "请确认已经完成充值或交付");
      sql = "UPDATE orders SET status='complete',completedAt=?,delivery=?,updatedAt=? WHERE id=? AND status=?" + (row.product === "muse-token" ? " AND NOT EXISTS (SELECT 1 FROM supplier_fulfillment WHERE orderId=orders.id AND state != 'ready')" : ""); args = [now, delivery, now, row.id, row.status];
    } else throw new HttpError(400, "操作无效");
    try {
      const result = await env.DB.batch([
        env.DB.prepare(sql).bind(...args),
        env.DB.prepare("INSERT INTO audit(orderId,action,createdAt) SELECT ?,?,? WHERE changes()=1").bind(row.id, String(input.action), now),
      ]);
      if (!result[0].meta.changes) throw new HttpError(409, "订单状态已更新，请刷新");
    } catch (error) { if (error instanceof HttpError) throw error; if (String(error).includes("UNIQUE")) throw new HttpError(409, "该支付交易单号已用于其他订单，请核对"); throw error; }
    return json({ ok: true });
  }
  throw new HttpError(404, "接口不存在");
}
const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url), path = url.pathname.replace(/\/$/, "");
    const origin = request.headers.get("Origin");
    const githubPagesOrigin = "https://daolingz46-tech.github.io";
    const corsOrigin = origin === url.origin || origin === githubPagesOrigin ? origin : "";
    const withCors = (response: Response) => {
      if (!corsOrigin) return response;
      const headers = new Headers(response.headers);
      headers.set("Access-Control-Allow-Origin", corsOrigin);
      headers.set("Access-Control-Allow-Credentials", "true");
      headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type");
      headers.set("Access-Control-Max-Age", "86400");
      headers.append("Vary", "Origin");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };
    try {
      if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
      if (request.method === "OPTIONS") {
        if (!corsOrigin) throw new HttpError(403, "请求来源无效，请刷新页面");
        return withCors(new Response(null, { status: 204 }));
      }
      const nativeAdmin = !origin && path.startsWith("/api/admin/") && (path === "/api/admin/mini-login" || /^Bearer [a-f0-9]{64}$/.test(request.headers.get("Authorization") || ""));
      const nativeStore = !origin && request.method === "POST" && ["/api/orders", "/api/orders/lookup", "/api/orders/report", "/api/orders/find"].includes(path);
      if (request.method !== "GET" && !corsOrigin && !nativeAdmin && !nativeStore) throw new HttpError(403, "请求来源无效，请刷新页面");
      if (request.method === "GET" && origin && !corsOrigin) throw new HttpError(403, "请求来源无效，请刷新页面");
      if (path === "/api/health" && request.method === "GET") {
        await env.DB.prepare("SELECT id FROM orders LIMIT 1").all();
        return withCors(json({ ok: true, service: "muse-store", checkedAt: Date.now() }));
      }
      if (path === "/api/referral" && request.method === "GET") {
        const code = url.searchParams.get("code") || "";
        if (!/^[a-f0-9]{32}$/.test(code)) return withCors(json({ valid:false }));
        const agent = await env.DB.prepare("SELECT id FROM agents WHERE referralCode=? AND status='active'").bind(code).first();
        return withCors(json({ valid: Boolean(agent) },200,{"Cache-Control":"no-store"}));
      }
      if (path === "/api/availability" && request.method === "GET") {
        await limit(env, request, "availability", 90, 60);
        if (!env.SUPPLIER_APP_ID || !env.SUPPLIER_SECRET) return withCors(json({ stock: {} }));
        const supplierProducts: Array<[string, { goodsNo: string }]> = [...Object.entries(GPT_SUPPLIER_PRODUCTS).filter(([key]) => key !== "halfPriceAccount"), ["museAccount", MUSE_ACCOUNT_SUPPLIER]];
        const entries = await Promise.all(supplierProducts.map(async ([key,plan]) => {
          try { for (const goodsNo of [plan.goodsNo,...(SUPPLIER_BACKUPS[key] || [])]) { const result = await supplierRequest({ appId: env.SUPPLIER_APP_ID!, secret: env.SUPPLIER_SECRET! }, "purchase", "quotePrice", { goods_no: goodsNo, quantity: 1 }) as {code:number;data?:{available_quantity?:number}}; const n = result.data?.available_quantity; if (result.code !== 1 || typeof n !== "number") return [key,null] as const; if (n > 0) return [key,true] as const; } return [key,false] as const; }
          catch { return [key, null] as const; }
        }));
        return withCors(json({ stock: Object.fromEntries(entries) }));
      }
      if (path.startsWith("/api/admin/")) return withCors(await admin(env, request, path));
      if (path.startsWith("/api/agent/")) return withCors(await agentApi(env, request, path));
      if (path === "/api/visit" && request.method === "POST") {
        await limit(env, request, "visit", 60, 60);
        const input = await body(request);
        const id = str(input.id, 64), page = input.page === "/" ? "/" : "";
        const source = ["direct", "wechat", "search", "social", "external"].includes(String(input.source)) ? String(input.source) : "external";
        const device = ["mobile", "tablet", "desktop"].includes(String(input.device)) ? String(input.device) : "desktop";
        if (!/^[a-f0-9-]{36}$/i.test(id) || !page) throw new HttpError(400, "访问记录无效");
        await env.DB.prepare("INSERT OR IGNORE INTO visits(id,page,source,device,createdAt) VALUES(?,?,?,?,?)").bind(id, page, source, device, Date.now()).run();
        return withCors(json({ ok: true }, 201));
      }
      if (/^\/api\/tutorial-images\/[a-f0-9-]{36}$/.test(path) && request.method === "GET") {
        const image = await env.DB.prepare("SELECT mime,data FROM tutorial_images WHERE id=?").bind(path.split("/").pop()).first<{ mime: string; data: string }>();
        if (!image) throw new HttpError(404, "图片不存在");
        const binary = atob(image.data), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return withCors(new Response(bytes.buffer as ArrayBuffer, { headers: { "Content-Type": image.mime, "Cache-Control": "public,max-age=31536000,immutable", "X-Content-Type-Options": "nosniff" } }));
      }
      if (/^\/api\/delivery-files\/[a-f0-9-]{36}$/.test(path) && request.method === "GET") {
        const id = path.split("/").pop()!;
        const signature = url.searchParams.get("signature") || "";
        if (!/^[a-f0-9]{64}$/.test(signature) || !same(signature, await fileSignature(env, id))) throw new HttpError(403, "附件链接无效");
        const file = await env.DB.prepare("SELECT * FROM delivery_files WHERE id=?").bind(id).first<DeliveryFile>();
        if (!file || file.uploadedBytes !== file.size) throw new HttpError(404, "附件不存在");
        const bytes = await fileBytes(env, id, file.size);
        return withCors(new Response(bytes.buffer as ArrayBuffer, { headers: { "Content-Type": file.mime, "Content-Length": String(file.size), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, "Cache-Control": "private,no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } }));
      }
      if (/^\/api\/payment-qr\/(wechat|alipay)$/.test(path) && request.method === "GET") {
        const imageUrl = new URL(`/sites/muse/${path.split("/").pop()}-collection.png`, url);
        const response = await env.ASSETS.fetch(new Request(imageUrl));
        return withCors(new Response(response.body, { status: response.status, headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }));
      }
      if (request.method !== "POST") throw new HttpError(405, "请求方式无效");
      const input = await body(request);
      if (path === "/api/product-request") {
        await limit(env, request, "product-request", 5, 3600);
        const message = str(input.message, 1000), id = str(input.id, 64);
        if (!message || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "请填写想要的商品");
        if (!hasEmailConfig(env)) throw new HttpError(503, "暂时无法发送，请稍后再试");
        try { await sendEmail(env, `request:${id}`, "客户想要的商品", `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>`, message); }
        catch { throw new HttpError(502, "暂时无法发送，请稍后再试"); }
        return withCors(json({ ok: true }));
      }
      if (path === "/api/orders") return withCors(await createOrder(env, request, input, ctx));
      if (path === "/api/orders/find") {
        const identifier = str(input.identifier, 64);
        if (!/^\d{4}$/.test(identifier) && !/^M[a-f0-9]{32}$/i.test(identifier)) throw new HttpError(400, "请输入 4 位订单码或完整订单编号");
        const short = /^\d{4}$/.test(identifier);
        await limit(env, request, short ? "short-code" : "order-id", short ? 20 : 60, 3600);
        const row = await env.DB.prepare(short ? "SELECT * FROM orders WHERE code=?" : "SELECT * FROM orders WHERE id=?").bind(short ? identifier : `M${identifier.slice(1).toLowerCase()}`).first<Row>();
        if (!row) throw new HttpError(404, "未找到订单，请检查输入");
        if (!short) return withCors(json({ kind: "full", order: publicOrder(row, await hash(`order-id-access:${row.id}`)) }));
        const status = row.status === "pending" && row.expiresAt <= Date.now() ? "expired" : row.status;
        return withCors(json({ kind: "summary", code: row.code, title: row.title, amountCents: row.amountCents, status }));
      }
      if (path === "/api/orders/lookup" || path === "/api/orders/report") {
        await limit(env, request, "lookup", 180, 60);
        const { row, token } = await getOrder(env, input);
        if (path.endsWith("/report")) {
          if (input.remarkConfirmed !== true) throw new HttpError(400, "请确认付款备注已填写订单码");
          if (row.status === "pending" || row.status === "expired") {
            const now = Date.now();
            const changed = await env.DB.prepare("UPDATE orders SET status='reported',reportedAt=?,updatedAt=? WHERE id=? AND status IN ('pending','expired')").bind(now, now, row.id).run();
            if (changed.meta.changes) await queueOrderPush(env, row, "reported", ctx);
          }
          const updated = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(row.id).first<Row>();
          await queueOrderEmail(env, updated!, "reported", ctx);
          return withCors(json(publicOrder(updated!, token)));
        }
        return withCors(json(publicOrder(row, token)));
      }
      throw new HttpError(404, "接口不存在");
    } catch (error) {
      if (error instanceof HttpError) return withCors(json({ message: error.message }, error.status));
      console.error("store_request_failed", error instanceof Error ? error.name : "UnknownError");
      return withCors(json({ message: "订单服务暂时不可用，请稍后重试" }, 500));
    }
  },
  async scheduled(_event: unknown, env: Env) { await expire(env); await sendOrderEmails(env); await sendOrderPushes(env); },
};
export default worker;
