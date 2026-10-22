import type { D1Database } from "@cloudflare/workers-types";
import { tokenPlans, accountPriceCents } from "../src/lib/products";

type Env = { DB: D1Database; ASSETS: { fetch(request: Request): Promise<Response> }; ADMIN_PASSWORD_HASH: string };
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
    env.DB.prepare("UPDATE orders SET activeCode=0 WHERE activeCode=1 AND status IN ('expired','complete') AND createdAt<?").bind(now - 30 * 86400000),
    env.DB.prepare("DELETE FROM sessions WHERE expiresAt<?").bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE expiresAt<?").bind(now),
  ]);
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
  const row = await env.DB.prepare("SELECT * FROM orders WHERE id=? AND tokenHash=?").bind(id, await hash(token)).first<Row>();
  if (!row) throw new HttpError(404, "订单不存在或查询口令不正确");
  return { row, token };
}
async function createOrder(env: Env, request: Request, input: Record<string, unknown>) {
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
  if (existing) { if (existing.inputHash !== inputHash) throw new HttpError(409, "订单内容已改变，请重新下单"); return json(publicOrder(existing, token)); }
  await limit(env, request, "create", 20, 3600);
  await expire(env);
  const now = Date.now(), id = `M${crypto.randomUUID().replaceAll("-", "")}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    const code = (crypto.getRandomValues(new Uint32Array(1))[0] % 10000).toString().padStart(4, "0");
    const result = await env.DB.prepare("INSERT OR IGNORE INTO orders(id,requestHash,inputHash,tokenHash,code,product,title,amountCents,target,method,createdAt,expiresAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, requestHash, inputHash, await hash(token), code, input.product, title, amount, target, input.method, now, now + 15 * 60000, now).run();
    const row = await env.DB.prepare("SELECT * FROM orders WHERE requestHash=?").bind(requestHash).first<Row>();
    if (row) { if (row.inputHash !== inputHash) throw new HttpError(409, "订单内容已改变，请重新下单"); return json(publicOrder(row, token), result.meta.changes ? 201 : 200); }
  }
  throw new HttpError(503, "当前订单较多，请稍后再试或联系支持");
}
function cookie(request: Request) { return request.headers.get("Cookie")?.match(/(?:^|;\s*)muse_admin=([a-f0-9]{64})(?:;|$)/)?.[1] || ""; }
function cookieHeader(request: Request, value: string, age: number) { return `muse_admin=${value}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`; }
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
  if (path === "/api/admin/update" && request.method === "POST") {
    const input = await body(request); const row = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(str(input.id, 64)).first<Row>();
    if (!row) throw new HttpError(404, "订单不存在");
    const now = Date.now(); let sql: string; let args: (string | number | null)[];
    if (input.action === "confirm") {
      if (!["pending", "reported", "expired"].includes(row.status)) throw new HttpError(409, "订单状态已更新，请刷新");
      const reference = str(input.reference, 100); if (reference.length < 6 || input.checked !== true) throw new HttpError(400, "请核对收款金额、时间、备注订单码，并填写支付交易单号");
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), path = url.pathname.replace(/\/$/, "");
    try {
      if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
      if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) throw new HttpError(403, "请求来源无效，请刷新页面");
      if (path.startsWith("/api/admin/")) return await admin(env, request, path);
      if (/^\/api\/payment-qr\/(wechat|alipay)$/.test(path) && request.method === "GET") {
        const imageUrl = new URL(`/sites/muse/${path.split("/").pop()}-collection.png`, url);
        const response = await env.ASSETS.fetch(new Request(imageUrl));
        return new Response(response.body, { status: response.status, headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      }
      if (request.method !== "POST") throw new HttpError(405, "请求方式无效");
      const input = await body(request);
      if (path === "/api/orders") return await createOrder(env, request, input);
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
          return json(publicOrder(updated!, token));
        }
        return json(publicOrder(row, token));
      }
      throw new HttpError(404, "接口不存在");
    } catch (error) {
      if (error instanceof HttpError) return json({ message: error.message }, error.status);
      console.error("store_request_failed", error instanceof Error ? error.name : "UnknownError");
      return json({ message: "订单服务暂时不可用，请稍后重试" }, 500);
    }
  },
  async scheduled(_event: unknown, env: Env) { await expire(env); },
};
export default worker;
