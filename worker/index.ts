import type { D1Database } from "@cloudflare/workers-types";
import { tokenPlans, accountPriceCents } from "../src/lib/products";

type Env = { DB: D1Database; ASSETS: { fetch(request: Request): Promise<Response> }; ADMIN_PASSWORD_HASH: string; RESEND_API_KEY?: string; GMAIL_SCRIPT_URL?: string; GMAIL_SCRIPT_TOKEN?: string };
type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };
type Row = {
  id: string; requestHash: string; inputHash: string; tokenHash: string; code: string;
  product: "muse" | "muse-token"; title: string; amountCents: number; target: string;
  method: "wechat" | "alipay"; status: string; createdAt: number; expiresAt: number;
  reportedAt: number | null; paidAt: number | null; completedAt: number | null;
  reference: string | null; delivery: string | null; updatedAt: number;
};
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...headers },
});
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
function str(value: unknown, max = 128) { return typeof value === "string" && value.trim().length <= max ? value.trim() : ""; }
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
async function sendEmail(env: Env, id: string, subject: string, html: string, text: string) {
  if (env.GMAIL_SCRIPT_URL && env.GMAIL_SCRIPT_TOKEN) {
    const response = await fetch(env.GMAIL_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, token: env.GMAIL_SCRIPT_TOKEN, to: "daolingz46@gmail.com", subject, html, text }), redirect: "follow" });
    const result = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null;
    if (!response.ok || !result?.ok) throw new Error(`gmail_script_${response.status}_${result?.message || "failed"}`);
    return;
  }
  if (!env.RESEND_API_KEY) throw new Error("email_not_configured");
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": id }, body: JSON.stringify({ from: "Muse 商店 <onboarding@resend.dev>", to: ["daolingz46@gmail.com"], subject, html, text }) });
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
      const html = `<div style="font-family:Arial,sans-serif;line-height:1.8;color:#202634"><h2>${esc(eventText)}</h2><p>订单码：<strong>${esc(order.code)}</strong></p><p>订单编号：${esc(order.id)}</p><p>商品：${esc(order.title)}</p><p>金额：¥${(order.amountCents / 100).toFixed(2)}</p><p>付款方式：${order.method === "wechat" ? "微信" : "支付宝"}</p><p>状态：${item.eventType === "reported" ? "等待店主核实" : "等待买家付款"}</p><p><a href="https://daolingz46-tech.github.io/muse-site-study/admin/">打开店主工作台</a></p></div>`;
      const text = `${eventText}\n订单码：${order.code}\n订单编号：${order.id}\n商品：${order.title}\n金额：¥${(order.amountCents / 100).toFixed(2)}\n付款方式：${order.method === "wechat" ? "微信" : "支付宝"}\n状态：${item.eventType === "reported" ? "等待店主核实" : "等待买家付款"}\n店主工作台：https://daolingz46-tech.github.io/muse-site-study/admin/`;
      await sendEmail(env, item.id, subject, html, text);
      await env.DB.prepare("UPDATE email_outbox SET sentAt=?,lastError=NULL WHERE id=?").bind(Date.now(), item.id).run();
    } catch (error) {
      const retryAt = Date.now() + Math.min(3600000, 15000 * 2 ** Math.min(item.attempts, 8));
      const reason = error instanceof Error ? error.message.slice(0, 120) : "send_failed";
      await env.DB.prepare("UPDATE email_outbox SET nextAttemptAt=?,lastError=? WHERE id=? AND sentAt IS NULL").bind(retryAt, reason, item.id).run();
    }
  }
}
function publicOrder(row: Row, token: string) {
  const status = row.status === "pending" && row.expiresAt <= Date.now() ? "expired" : row.status;
  return { id: row.id, token, code: row.code, product: row.product, title: row.title,
    amountCents: row.amountCents, feeCents: 0, method: row.method, status,
    createdAt: row.createdAt, expiresAt: row.expiresAt, reportedAt: row.reportedAt,
    ...(row.product === "muse" ? { email: row.target } : { inviteCode: row.target }),
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
  if (input.product === "muse") { title = "Muse AI · 成品账号"; amount = accountPriceCents; target = str(input.email, 254); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) throw new HttpError(400, "请填写有效邮箱"); }
  else if (input.product === "muse-token") { const plan = tokenPlans.find(p => p.id === input.planId); if (!plan) throw new HttpError(400, "充值档次无效"); amount = plan.amountCents; title = `Muse Token · ${plan.label}`; target = str(input.inviteCode); if (!target) throw new HttpError(400, "账号邀请码为必填项"); }
  else throw new HttpError(400, "商品不存在");
  const requestHash = await hash(requestId), token = await hash(`order-lookup:${requestId}`);
  const inputHash = await hash(JSON.stringify([input.product, title, amount, target, input.method]));
  const existing = await env.DB.prepare("SELECT * FROM orders WHERE requestHash=?").bind(requestHash).first<Row>();
  if (existing) { if (existing.inputHash !== inputHash) throw new HttpError(409, "订单内容已改变，请重新下单"); await queueOrderEmail(env, existing, "created", ctx); return json(publicOrder(existing, token)); }
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
    const result = await env.DB.prepare("INSERT OR IGNORE INTO orders(id,requestHash,inputHash,tokenHash,code,product,title,amountCents,target,method,createdAt,expiresAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, requestHash, inputHash, await hash(token), code, input.product, title, amount, target, input.method, now, now + 15 * 60000, now).run();
    const row = await env.DB.prepare("SELECT * FROM orders WHERE requestHash=?").bind(requestHash).first<Row>();
    if (row) { if (row.inputHash !== inputHash) throw new HttpError(409, "订单内容已改变，请重新下单"); await queueOrderEmail(env, row, "created", ctx); return json(publicOrder(row, token), result.meta.changes ? 201 : 200); }
  }
  throw new HttpError(503, "当前订单较多，请稍后再试或联系支持");
}
function cookie(request: Request) { return request.headers.get("Cookie")?.match(/(?:^|;\s*)muse_admin=([a-f0-9]{64})(?:;|$)/)?.[1] || ""; }
function cookieHeader(request: Request, value: string, age: number) { const secure = new URL(request.url).protocol === "https:"; return `muse_admin=${value}; HttpOnly; SameSite=${secure ? "None" : "Lax"}; Path=/api/admin; Max-Age=${age}${secure ? "; Secure" : ""}`; }
async function requireAdmin(env: Env, request: Request) {
  const session = cookie(request);
  if (!session || !await env.DB.prepare("SELECT hash FROM sessions WHERE hash=? AND expiresAt>?").bind(await hash(session), Date.now()).first()) throw new HttpError(401, "请登录工作台");
}
async function admin(env: Env, request: Request, path: string) {
  if (path === "/api/admin/login" && request.method === "POST") {
    await limit(env, request, "login", 8, 900);
    if (!/^[a-f0-9]{64}$/.test(env.ADMIN_PASSWORD_HASH || "")) throw new HttpError(503, "工作台尚未配置登录密码");
    const input = await body(request); const password = str(input.password, 256);
    if (!password || !same(await hash(password), env.ADMIN_PASSWORD_HASH)) throw new HttpError(401, "密码不正确");
    const session = await hash(crypto.randomUUID() + crypto.randomUUID());
    await env.DB.prepare("INSERT INTO sessions(hash,expiresAt) VALUES(?,?)").bind(await hash(session), Date.now() + 8 * 3600000).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookieHeader(request, session, 28800) });
  }
  await requireAdmin(env, request);
  if (path === "/api/admin/email-status" && request.method === "GET") return json({ configured: hasEmailConfig(env), provider: env.GMAIL_SCRIPT_URL && env.GMAIL_SCRIPT_TOKEN ? "gmail" : env.RESEND_API_KEY ? "resend" : "none" });
  if (path === "/api/admin/email-test" && request.method === "POST") {
    if (!hasEmailConfig(env)) throw new HttpError(503, "邮件服务尚未配置");
    try { await sendEmail(env, `muse-email-test-${crypto.randomUUID()}`, "Muse 商店邮件提醒测试", "<p>邮件提醒已成功连接。新订单和买家付款反馈将自动发送到此邮箱。</p>", "邮件提醒已成功连接。新订单和买家付款反馈将自动发送到此邮箱。"); }
    catch { throw new HttpError(502, "邮件测试失败，请检查 Gmail 脚本部署地址和令牌，或 Resend API Key"); }
    return json({ ok: true });
  }
  if (path === "/api/admin/logout" && request.method === "POST") { await env.DB.prepare("DELETE FROM sessions WHERE hash=?").bind(await hash(cookie(request))).run(); return json({ ok: true }, 200, { "Set-Cookie": cookieHeader(request, "", 0) }); }
  if (path === "/api/admin/orders" && request.method === "GET") {
    await expire(env);
    const url = new URL(request.url); const search = str(url.searchParams.get("q")); const status = str(url.searchParams.get("status"), 20); const page = Math.max(0, Math.min(100000, Number(url.searchParams.get("page")) || 0));
    const where = "WHERE (?='' OR code=? OR id=? OR target LIKE ? ESCAPE '\\') AND (?='' OR status=?)";
    const values = [search, search, search, `%${search.replace(/[\\%_]/g, "\\$&")}%`, status, status];
    const rows = await env.DB.prepare(`SELECT id,code,product,title,amountCents,target,method,status,createdAt,expiresAt,reportedAt,paidAt,completedAt,reference,updatedAt FROM orders ${where} ORDER BY createdAt DESC LIMIT 50 OFFSET ?`).bind(...values, page * 50).all();
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
      let delivery: string | null = null;
      if (row.product === "muse") { const d = input.delivery as Record<string, unknown> | undefined; const email = str(d?.email, 254), password = str(d?.password, 256), codeUrl = str(d?.codeUrl, 1000); if (!email || !password || !/^https:\/\//.test(codeUrl)) throw new HttpError(400, "请填写交付账号、密码和 HTTPS 接码链接"); delivery = JSON.stringify({ email, password, codeUrl }); }
      if (input.checked !== true) throw new HttpError(400, "请确认已经完成充值或交付");
      sql = "UPDATE orders SET status='complete',completedAt=?,delivery=?,updatedAt=? WHERE id=? AND status=?"; args = [now, delivery, now, row.id, row.status];
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
      if (request.method !== "GET" && !corsOrigin) throw new HttpError(403, "请求来源无效，请刷新页面");
      if (request.method === "GET" && origin && !corsOrigin) throw new HttpError(403, "请求来源无效，请刷新页面");
      if (path.startsWith("/api/admin/")) return withCors(await admin(env, request, path));
      if (path === "/api/visit" && request.method === "POST") {
        await limit(env, request, "visit", 60, 60);
        const input = await body(request);
        const id = str(input.id, 64), page = input.page === "/" ? "/" : "";
        const source = ["direct", "search", "social", "external"].includes(String(input.source)) ? String(input.source) : "external";
        const device = ["mobile", "tablet", "desktop"].includes(String(input.device)) ? String(input.device) : "desktop";
        if (!/^[a-f0-9-]{36}$/i.test(id) || !page) throw new HttpError(400, "访问记录无效");
        await env.DB.prepare("INSERT OR IGNORE INTO visits(id,page,source,device,createdAt) VALUES(?,?,?,?,?)").bind(id, page, source, device, Date.now()).run();
        return withCors(json({ ok: true }, 201));
      }
      if (/^\/api\/payment-qr\/(wechat|alipay)$/.test(path) && request.method === "GET") {
        const imageUrl = new URL(`/sites/muse/${path.split("/").pop()}-collection.png`, url);
        const response = await env.ASSETS.fetch(new Request(imageUrl));
        return withCors(new Response(response.body, { status: response.status, headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }));
      }
      if (request.method !== "POST") throw new HttpError(405, "请求方式无效");
      const input = await body(request);
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
            await env.DB.prepare("UPDATE orders SET status='reported',reportedAt=?,updatedAt=? WHERE id=? AND status IN ('pending','expired')").bind(now, now, row.id).run();
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
  async scheduled(_event: unknown, env: Env) { await expire(env); await sendOrderEmails(env); },
};
export default worker;
