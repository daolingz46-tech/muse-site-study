import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("订单、收款核实和交付的数据库流程", async t => {
  mkdirSync("temp/worker", { recursive: true });
  const build = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "deploy", "--dry-run", "--outdir", "temp/worker"], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const password = randomUUID() + randomUUID();
  const sentMessages = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "test-store", modules: true, scriptPath: "temp/worker/index.js", compatibilityDate: "2026-10-01", d1Databases: { DB: "test-orders" }, bindings: { ADMIN_PASSWORD_HASH: createHash("sha256").update(password).digest("hex"), GMAIL_SCRIPT_URL: "https://mail.test/exec", GMAIL_SCRIPT_TOKEN: "test-token" }, outboundService: async request => {
    assert.equal(new URL(request.url).hostname, "mail.test");
    const input = await request.json();
    if (input.purpose === "capability_probe") return Response.json({ ok: true, buyerDelivery: true });
    sentMessages.push(input);
    return Response.json({ ok: true });
  } }] }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  for (const migration of readdirSync("migrations").filter(f => f.endsWith(".sql")).sort()) for (const statement of readFileSync(`migrations/${migration}`, "utf8").split(";").filter(s => s.trim())) await db.prepare(statement).run();
  const call = async (path, payload, cookie = "", origin = "https://shop.example") => {
    const response = await mf.dispatchFetch(`https://shop.example${path}`, { method: payload === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const input = { product: "muse-token", planId: "100", inviteCode: "TEST-INVITE", method: "wechat", acceptedTerms: true, requestId: randomUUID(), amountCents: 1 };
  let order, session, other;
  await t.test("服务器决定价格，4 位订单码包含前导零规则，邀请码必填", async () => {
    assert.equal((await call("/api/orders", { ...input, inviteCode: "" })).status, 400);
    const r = await call("/api/orders", input); assert.equal(r.status, 201); order = r.data;
    assert.equal(order.amountCents, 2900); assert.match(order.code, /^\d{4}$/); assert.equal(order.status, "pending");
    assert.equal(order.qrImageUrl, "/api/payment-qr/wechat");
    const rows = await db.prepare("SELECT * FROM orders").all(); assert.equal(rows.results.length, 1);
    assert.notEqual(rows.results[0].tokenHash, order.token);
  });
  await t.test("并发重试不重复下单，修改参数不能复用旧请求", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => call("/api/orders", input)));
    assert.ok(results.every(r => r.data.id === order.id && r.data.code === order.code && r.data.token === order.token));
    assert.equal((await call("/api/orders", { ...input, planId: "300" })).status, 409);
    const created = await Promise.all(Array.from({ length: 6 }, () => call("/api/orders", { ...input, requestId: randomUUID() })));
    assert.equal(new Set([order.code, ...created.map(r => r.data.code)]).size, 7); other = created[0].data;
  });
  await t.test("订单口令与管理权限隔离，拒绝跨站写入", async () => {
    assert.equal((await call("/api/orders/lookup", { id: order.id, token: order.code })).status, 404);
    assert.equal((await call("/api/admin/orders")).status, 401);
    assert.equal((await call("/api/admin/update", { id: order.id, action: "confirm" })).status, 401);
    assert.equal((await call("/api/orders", input, "", "https://evil.example")).status, 403);
    assert.equal((await call("/api/orders/lookup", order)).data.code, order.code);
  });
  await t.test("买家反馈不会变为已收款或计入收入", async () => {
    assert.equal((await call("/api/orders/report", order)).status, 400);
    const r = await call("/api/orders/report", { ...order, remarkConfirmed: true }); assert.equal(r.data.status, "reported");
    const login = await call("/api/admin/login", { password }); assert.equal(login.status, 200); session = login.cookie;
    const list = await call("/api/admin/orders", undefined, session); assert.equal(list.data.summary.awaiting, 1); assert.equal(list.data.summary.revenueCents, 0);
    assert.equal("tokenHash" in list.data.orders[0], false);
  });
  await t.test("核实收款的交易号选填，填写后不能重复使用", async () => {
    assert.equal((await call("/api/admin/update", { id: order.id, action: "complete", checked: true }, session)).status, 409);
    assert.equal((await call("/api/admin/update", { id: order.id, action: "confirm" }, session)).status, 200);
    const list = await call("/api/admin/orders?q=" + order.code, undefined, session);
    assert.equal(list.data.count.total, 1); assert.equal(list.data.summary.revenueCents, 2900); assert.equal(list.data.orders[0].status, "processing");
    const first = (await call("/api/orders", { product: "muse", email: "first@example.com", method: "alipay", acceptedTerms: true, requestId: randomUUID() })).data;
    const second = (await call("/api/orders", { product: "muse", email: "second@example.com", method: "alipay", acceptedTerms: true, requestId: randomUUID() })).data;
    const reference = "TEST-TRANSACTION-001";
    assert.equal((await call("/api/admin/update", { id: first.id, action: "confirm", checked: true, reference }, session)).status, 200);
    assert.equal((await call("/api/admin/update", { id: second.id, action: "confirm", checked: true, reference }, session)).status, 409);
  });
  await t.test("完成充值、审计记录、账号资料交付", async () => {
    assert.equal((await call("/api/admin/update", { id: order.id, action: "complete", checked: true }, session)).status, 200);
    assert.equal((await call("/api/orders/lookup", order)).data.status, "complete");
    const audit = await db.prepare("SELECT * FROM audit WHERE orderId=?").bind(order.id).all(); assert.equal(audit.results.length, 2);
    const account = (await call("/api/orders", { product: "muse", email: "buyer@example.com", method: "alipay", acceptedTerms: true, requestId: randomUUID() })).data;
    assert.equal(account.amountCents, 1500);
    assert.equal(account.title, "Muse AI · 成品账号 + 10亿 Token");
    await call("/api/admin/update", { id: account.id, action: "confirm", checked: true, reference: "TEST-ALIPAY-002" }, session);
    assert.equal((await call("/api/admin/update", { id: account.id, action: "complete", checked: true }, session)).status, 400);
    const delivery = { email: "delivered@example.com", password: "test-only", codeUrl: "https://example.com/code" };
    assert.equal((await call("/api/admin/update", { id: account.id, action: "complete", checked: true, delivery }, session)).status, 200);
    assert.deepEqual((await call("/api/orders/lookup", account)).data.delivery, delivery);
    const byId = await call("/api/orders/find", { identifier: account.id });
    assert.equal(byId.data.kind, "full"); assert.deepEqual(byId.data.order.delivery, delivery);
    assert.equal((await call("/api/orders/lookup", byId.data.order)).data.status, "complete");
    const byCode = await call("/api/orders/find", { identifier: account.code });
    assert.equal(byCode.data.kind, "summary"); assert.equal(byCode.data.status, "complete");
    for (const secret of ["id", "token", "email", "target", "delivery", "tokenHash"]) assert.equal(secret in byCode.data, false);
    assert.equal((await call("/api/orders/report", { id: account.code, token: account.code, remarkConfirmed: true })).status, 404);
  });
  await t.test("过期订单允许核查迟到付款，已用码永不复用", async () => {
    await db.prepare("UPDATE orders SET expiresAt=? WHERE id=?").bind(Date.now() - 1000, other.id).run();
    assert.equal((await call("/api/orders/lookup", other)).data.status, "expired");
    assert.equal((await call("/api/orders/report", { ...other, remarkConfirmed: true })).data.status, "reported");
    assert.equal((await db.prepare("SELECT activeCode FROM orders WHERE id=?").bind(other.id).first()).activeCode, 1);
    await db.prepare("UPDATE orders SET createdAt=? WHERE id=?").bind(Date.now() - 40 * 86400000, order.id).run();
    await call("/api/admin/orders", undefined, session);
    assert.equal((await db.prepare("SELECT activeCode FROM orders WHERE id=?").bind(order.id).first()).activeCode, 1);
    const duplicate = await db.prepare("UPDATE OR IGNORE orders SET code=? WHERE id=?").bind(order.code, other.id).run();
    assert.equal(duplicate.meta.changes, 0);
    await call("/api/admin/logout", {}, session);
    assert.equal((await call("/api/admin/orders", undefined, session)).status, 401);
  });
  await t.test("新订单和首次付款反馈各生成一次手机推送任务", async () => {
    const endpoint = "https://web.push.apple.com/test-subscription";
    await db.prepare("INSERT INTO push_subscriptions(endpoint,subscription,createdAt) VALUES(?,?,?)")
      .bind(endpoint, JSON.stringify({ endpoint, expirationTime: null, keys: { auth: "a".repeat(22), p256dh: "b".repeat(87) } }), Date.now()).run();
    const request = { product: "muse-token", planId: "100", inviteCode: "PUSH-TEST", method: "wechat", acceptedTerms: true, requestId: randomUUID() };
    const created = (await call("/api/orders", request)).data;
    await call("/api/orders", request);
    await call("/api/orders/report", { ...created, remarkConfirmed: true });
    await call("/api/orders/report", { ...created, remarkConfirmed: true });
    const queued = await db.prepare("SELECT eventType FROM push_outbox WHERE orderId=? ORDER BY eventType").bind(created.id).all();
    assert.deepEqual(queued.results.map(row => row.eventType), ["created", "reported"]);
  });
  await t.test("图文教程保存、图片读取和成品账号邮件交付权限", async () => {
    const login = await call("/api/admin/login", { password });
    const adminCookie = login.cookie;
    const account = (await call("/api/orders", { product: "muse", email: "tutorial-buyer@example.com", method: "wechat", acceptedTerms: true, requestId: randomUUID() })).data;
    assert.equal((await call("/api/admin/send-delivery", { id: account.id, card: "CARD-TEST" }, adminCookie)).status, 409);
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const uploaded = await mf.dispatchFetch("https://shop.example/api/admin/tutorial-image", { method: "POST", headers: { Origin: "https://shop.example", Cookie: adminCookie, "Content-Type": "image/png" }, body: png });
    assert.equal(uploaded.status, 201);
    const { url } = await uploaded.json();
    const image = await mf.dispatchFetch(`https://shop.example${new URL(url).pathname}`);
    assert.equal(image.status, 200); assert.equal(image.headers.get("content-type"), "image/png");
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), png);
    assert.equal((await call("/api/admin/tutorial", { title: "教程", blocks: [{ type: "image", url: "https://evil.example/pixel.png", caption: "x" }] }, adminCookie)).status, 400);
    assert.equal((await call("/api/admin/tutorial", { title: "教程", blocks: [{ type: "text", content: "第一步" }, { type: "image", url, caption: "截图" }] }, adminCookie)).status, 200);
    const tutorial = await call("/api/admin/tutorial", undefined, adminCookie);
    assert.equal(tutorial.data.blocks.length, 2);
    assert.equal((await call("/api/admin/update", { id: account.id, action: "confirm" }, adminCookie)).status, 200);
    assert.equal((await call("/api/admin/email-status", undefined, adminCookie)).data.buyerDelivery, true);
    assert.equal((await call("/api/admin/send-delivery", { id: account.id, card: "CARD-TEST" }, adminCookie)).status, 200);
    assert.equal((await call("/api/admin/send-delivery", { id: account.id, card: "CARD-TEST" }, adminCookie)).status, 409);
    const delivered = (await call("/api/orders/lookup", account)).data;
    assert.equal(delivered.status, "complete"); assert.equal(delivered.delivery.method, "email");
    assert.ok(sentMessages.some(message => message.to === "tutorial-buyer@example.com" && message.html.includes("CARD-TEST") && message.html.includes(url)));
    const stored = await db.prepare("SELECT delivery FROM orders WHERE id=?").bind(account.id).first();
    assert.equal(stored.delivery.includes("CARD-TEST"), false);
  });
});
