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
  let supplierPurchases = 0;
  let supplierTimeout = false;
  let supplierBalanceEnough = true;
  let supplierStock = null;
  let supplierGoods = ""; let supplierQuantity = 0; let supplierRemark = "";
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "test-store", modules: true, scriptPath: "temp/worker/index.js", compatibilityDate: "2026-10-01", d1Databases: { DB: "test-orders" }, bindings: { ADMIN_PASSWORD_HASH: createHash("sha256").update(password).digest("hex"), GMAIL_SCRIPT_URL: "https://mail.test/exec", GMAIL_SCRIPT_TOKEN: "test-token", SUPPLIER_APP_ID: "test-app", SUPPLIER_SECRET: "test-secret" }, outboundService: async request => {
    if (new URL(request.url).hostname === "www.16688.com.cn") {
      const path = new URL(request.url).pathname;
      const params = await request.json();
      if (path.endsWith("/quotePrice")) return Response.json({ code: 1, data: { balance_enough: supplierBalanceEnough, available_quantity: supplierStock, total_amount: params.goods_no === "G85161614" ? params.quantity * 1.03 : params.goods_no === "G43844575" ? 4.12 : params.goods_no === "G39595340" ? 11.31 : params.goods_no === "G97316889" ? 60.65 : 110 } });
      if (path.endsWith("/create")) { supplierGoods = params.goods_no; supplierQuantity = params.quantity; supplierRemark = params.remark; supplierPurchases++; if (supplierTimeout) throw new Error("simulated network failure"); return Response.json({ code: 1, data: { trade_no: "TEST-16688" } }); }
      if (path.endsWith("/query") && supplierGoods === "G85161614") return Response.json({code:1,data:{status:4,cards:Array.from({length:supplierQuantity},(_,i)=>({code:`TEST-${i}`}))}});
      if (path.endsWith("/query") && params.trade_no === "INVENTORY-ORDER") return Response.json({ code: 1, data: { goods_no: "G43844575", status: 4, cards: [{ code: "stock@example.com—pass--https://example.com/code" }], instruction: "说明" } });
      if (path.endsWith("/query")) return Response.json({ code: 1, data: { status: 4, cards: [{ code: supplierGoods === "G43844575" ? "muse@example.com—mailpass--https://example.com/code" : "TEST-CARD" }], instruction: "<h3>使用说明</h3><p>打开 <a href=\"https://example.com/redeem\">兑换地址</a></p>" } });
      throw new Error("unexpected supplier request");
    }
    assert.equal(new URL(request.url).hostname, "mail.test");
    const input = await request.json();
    if (input.purpose === "capability_probe") return Response.json({ ok: true, buyerDelivery: true, attachments: true });
    if (input.purpose === "customer_threads") return Response.json({ok:true,messages:[{id:"mail1",direction:"received",subject:"订单 1234",text:"hello",date:100,canReply:true},{id:"mail2",direction:"received",subject:"其他问题",text:"help",date:101,canReply:true}]});
    if (input.purpose === "customer_reply") { sentMessages.push(input); return Response.json({ok:true}); }
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
    assert.equal(order.amountCents, 2030); assert.match(order.code, /^\d{4}$/); assert.equal(order.status, "pending");
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
  await t.test("改价后旧订单重试保留原金额，所有 Muse 档位按新价创建", async () => {
    for (const [planId, amountCents] of [["300",5530],["200",3640],["150",3150],["100",2030]]) {
      const r = await call("/api/orders", { ...input, planId, requestId: randomUUID() });
      assert.equal(r.data.amountCents, amountCents);
    }
    const legacyInput = { ...input, requestId: randomUUID() };
    const legacy = (await call("/api/orders", legacyInput)).data;
    const oldHash = createHash("sha256").update(JSON.stringify(["muse-token", "Muse Token · 100亿 Token", 2900, legacyInput.inviteCode, legacyInput.method])).digest("hex");
    await db.prepare("UPDATE orders SET amountCents=?,inputHash=? WHERE id=?").bind(2900, oldHash, legacy.id).run();
    const retried = await call("/api/orders", legacyInput);
    assert.equal(retried.data.id, legacy.id); assert.equal(retried.data.amountCents, 2900);
    assert.equal((await call("/api/orders", { ...legacyInput, planId: "200" })).status, 409);
    await db.prepare("DELETE FROM rate_limits").run();
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
    assert.equal(list.data.count.total, 1); assert.equal(list.data.summary.revenueCents, 2030); assert.equal(list.data.orders[0].status, "processing");
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
    assert.equal(account.amountCents, 1200);
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
  await t.test("公开健康检查不暴露订单；店主邮箱作为买家邮箱时仍按交付邮件处理", async () => {
    const health = await call("/api/health"); assert.equal(health.status, 200); assert.equal(health.data.ok, true);
    assert.deepEqual(Object.keys(health.data).sort(), ["checkedAt", "ok", "service"]);
    const login = await call("/api/admin/login", { password });
    const account = (await call("/api/orders", { product: "muse", email: "daolingz46@gmail.com", method: "wechat", acceptedTerms: true, requestId: randomUUID() })).data;
    await call("/api/admin/update", { id: account.id, action: "confirm" }, login.cookie);
    assert.equal((await call("/api/admin/send-delivery", { id: account.id, card: "OWNER-TEST" }, login.cookie)).status, 200);
    assert.equal(sentMessages.find(m => m.text?.includes("OWNER-TEST")).purpose, "buyer_delivery");
    const list = await call("/api/admin/orders?q=" + account.code, undefined, login.cookie);
    assert.equal(list.data.orders[0].emailSendCount, 1); assert.ok(list.data.orders[0].emailSentAt);
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
    const started = await call("/api/admin/delivery-file/start", { orderId: account.id, name: "步骤.png", mime: "image/png", size: png.length }, adminCookie);
    assert.equal(started.status, 201);
    const chunk = await mf.dispatchFetch(`https://shop.example/api/admin/delivery-file/${started.data.id}/0`, { method: "POST", headers: { Origin: "https://shop.example", Cookie: adminCookie, "Content-Type": "application/octet-stream" }, body: png });
    assert.equal(chunk.status, 200);
    assert.equal((await mf.dispatchFetch(`https://shop.example/api/delivery-files/${started.data.id}`)).status, 403);
    assert.equal((await call("/api/admin/send-delivery", { id: account.id, card: "CARD-TEST", includeTutorial: false, fileIds: [started.data.id] }, adminCookie)).status, 200);
    const firstMail = sentMessages.find(message => message.to === "tutorial-buyer@example.com");
    assert.equal(firstMail.html.includes(url), false);
    assert.equal(firstMail.attachments.length, 1);
    assert.equal((await mf.dispatchFetch(firstMail.attachments[0].url)).status, 200);
    const video = Uint8Array.from({ length: 1_800_123 }, (_, i) => i % 251);
    const videoStart = await call("/api/admin/delivery-file/start", { orderId: account.id, name: "video.mp4", mime: "video/mp4", size: video.length }, adminCookie);
    const uploadPart = part => mf.dispatchFetch(`https://shop.example/api/admin/delivery-file/${videoStart.data.id}/${part}`, { method: "POST", headers: { Origin: "https://shop.example", Cookie: adminCookie, "Content-Type": "application/octet-stream" }, body: video.slice(part * videoStart.data.chunkBytes, (part + 1) * videoStart.data.chunkBytes) });
    assert.equal((await uploadPart(0)).status, 200);
    assert.equal((await call("/api/admin/send-delivery", { id: account.id, card: "VIDEO", fileIds: [videoStart.data.id] }, adminCookie)).status, 400);
    assert.equal((await uploadPart(1)).status, 200);
    assert.equal((await call("/api/admin/send-delivery", { id: account.id, card: "VIDEO", fileIds: [videoStart.data.id] }, adminCookie)).status, 200);
    const videoMail = sentMessages.find(m => m.attachments?.some(file => file.name === "video.mp4"));
    const downloaded = await mf.dispatchFetch(videoMail.attachments[0].url);
    assert.equal(downloaded.status, 200);
    assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), video);
    assert.equal((await call("/api/admin/send-delivery", { id: account.id, card: "CARD-TEST-AGAIN", includeTutorial: true, fileIds: [] }, adminCookie)).status, 200);
    assert.equal((await db.prepare("SELECT sendCount FROM delivery_emails WHERE orderId=?").bind(account.id).first()).sendCount, 3);
    const delivered = (await call("/api/orders/lookup", account)).data;
    assert.equal(delivered.status, "complete"); assert.equal(delivered.delivery.method, "email");
    assert.ok(sentMessages.some(message => message.to === "tutorial-buyer@example.com" && message.html.includes("CARD-TEST-AGAIN") && message.html.includes(url)));
    const stored = await db.prepare("SELECT delivery FROM orders WHERE id=?").bind(account.id).first();
    assert.equal(stored.delivery.includes("CARD-TEST"), false);
  });
  await t.test("GPT 核款后手动采购并发送，重复发货不重复采购", async () => {
    session = (await call("/api/admin/login", { password })).cookie;
    const oldAccount = await call("/api/orders", { product: "gpt", planId: "halfPriceAccount", email: "old@example.com", method: "alipay", acceptedTerms: true, requestId: randomUUID() });
    const newAccount = await call("/api/orders", { product: "gpt", planId: "halfPriceAccountOneMonth", email: "new@example.com", method: "alipay", acceptedTerms: true, requestId: randomUUID() });
    assert.equal(oldAccount.data.title, "GPT · 两个月半价资格账号");
    assert.equal(newAccount.data.title, "GPT · 一个月半价资格账号");
    assert.equal(newAccount.data.amountCents, 1500);
    assert.equal((await db.prepare("SELECT supplierPlan FROM orders WHERE id=?").bind(oldAccount.data.id).first()).supplierPlan, "halfPriceAccount");
    assert.equal((await db.prepare("SELECT supplierPlan FROM orders WHERE id=?").bind(newAccount.data.id).first()).supplierPlan, "halfPriceAccountOneMonth");
    const payload = { product: "gpt", planId: "philippinesTopup", email: "gpt@example.com", method: "alipay", acceptedTerms: true, requestId: randomUUID() };
    const created = await call("/api/orders", payload); assert.equal(created.status, 201); assert.equal(created.data.amountCents, 12800);
    const gpt = created.data;
    const priorHash = createHash("sha256").update(JSON.stringify(["gpt", gpt.title, 11900, payload.email, payload.method])).digest("hex");
    const currentHash = createHash("sha256").update(JSON.stringify(["gpt", gpt.title, 12800, payload.email, payload.method])).digest("hex");
    await db.prepare("UPDATE orders SET amountCents=?,inputHash=? WHERE id=?").bind(11900, priorHash, gpt.id).run();
    const priorRetry = await call("/api/orders", payload);
    assert.equal(priorRetry.data.id, gpt.id); assert.equal(priorRetry.data.amountCents, 11900);
    await db.prepare("UPDATE orders SET amountCents=?,inputHash=? WHERE id=?").bind(12800, currentHash, gpt.id).run();
    assert.equal((await call("/api/admin/supplier-deliver", { id: gpt.id }, session)).status, 409);
    assert.equal(supplierPurchases, 0);
    const tokenWithEmail = await call("/api/orders", { product: "muse-token", planId: "100", inviteCode: "INVITE", email: "token@example.com", method: "alipay", acceptedTerms: true, requestId: randomUUID() });
    assert.equal(tokenWithEmail.status, 201);
    assert.equal((await call("/api/admin/contact-buyer", { id: tokenWithEmail.data.id, message: "充值进度" }, session)).status, 200);
    assert.ok(sentMessages.some(item => item.to === "token@example.com" && item.text.includes("充值进度")));
    assert.equal((await call("/api/admin/contact-buyer", { id: gpt.id, message: "请联系店主 QQ 123" })).status, 401);
    assert.equal((await call("/api/admin/contact-buyer", { id: gpt.id, message: "请联系店主 QQ 123" }, session)).status, 200);
    assert.ok(sentMessages.some(item => item.to === "gpt@example.com" && item.text.includes("QQ 123")));
    const suggestion = await call("/api/product-request", { id: randomUUID(), message: "希望上架 Grok" });
    assert.equal(suggestion.status, 200);
    assert.ok(sentMessages.some(item => item.purpose === "owner_notice" && item.text.includes("Grok")));
    const availability = await call("/api/availability");
    assert.equal(availability.data.stock.philippinesTopup, null);
    assert.equal((await call("/api/admin/update", { id: gpt.id, action: "confirm" }, session)).status, 200);
    supplierStock = 0;
    assert.equal((await call("/api/admin/supplier-deliver", { id: gpt.id }, session)).status, 409);
    assert.equal((await call("/api/orders/lookup", gpt)).data.stockIssue, true);
    assert.equal(supplierPurchases, 0);
    supplierStock = 1;
    supplierBalanceEnough = false;
    const insufficient = await call("/api/admin/supplier-deliver", { id: gpt.id }, session);
    assert.equal(insufficient.status, 409); assert.match(insufficient.data.message, /运营钱包余额不足/); assert.equal(supplierPurchases, 0);
    supplierBalanceEnough = true;
    assert.equal((await call("/api/admin/supplier-deliver", { id: gpt.id }, session)).status, 200);
    assert.equal(supplierPurchases, 1);
    assert.equal((await call("/api/admin/supplier-deliver", { id: gpt.id }, session)).status, 409);
    assert.equal(supplierPurchases, 1);
    assert.equal((await call("/api/orders/lookup", gpt)).data.status, "complete");
    const catalog = await call("/api/admin/catalog", undefined, session);
    assert.equal(catalog.data.products.find(item => item.supplier === "G19335525").sales, 1);
    assert.equal(catalog.data.products.find(item => item.supplier === "G75777360").sales, 0);
    assert.ok(sentMessages.some(item => item.to === "gpt@example.com" && item.text.includes("TEST-CARD")));
    const gptMail = sentMessages.find(item => item.to === "gpt@example.com" && item.text.includes("TEST-CARD"));
    assert.doesNotMatch(gptMail.text, /<h3|<a /); assert.match(gptMail.text, /https:\/\/example.com\/redeem/);
    assert.equal((await call("/api/orders", { ...payload, planId: "halfPriceTopup", requestId: randomUUID() })).status, 400);
    const another = (await call("/api/orders", { ...payload, requestId: randomUUID() })).data;
    await call("/api/admin/update", { id: another.id, action: "confirm" }, session);
    supplierTimeout = true;
    assert.equal((await call("/api/admin/supplier-deliver", { id: another.id }, session)).status, 502);
    supplierTimeout = false;
    assert.equal((await call("/api/admin/supplier-deliver", { id: another.id }, session)).status, 409);
    assert.equal(supplierPurchases, 2);

  });

  await t.test("Muse 货源采购与手动发卡互斥", async () => {
    const account = (await call("/api/orders", { product: "muse", email: "muse-buyer@example.com", method: "alipay", acceptedTerms: true, requestId: randomUUID() })).data;
    assert.equal((await call("/api/admin/supplier-deliver", { id: account.id }, session)).status, 409);
    await call("/api/admin/update", { id: account.id, action: "confirm" }, session);
    const before = supplierPurchases;
    assert.equal((await call("/api/admin/supplier-deliver", { id: account.id }, session)).status, 200);
    assert.equal(supplierPurchases, before + 1); assert.equal(supplierGoods, "G43844575");
    const mail = sentMessages.find(item => item.to === "muse-buyer@example.com" && item.text.includes("muse@example.com"));
    assert.ok(mail); assert.match(mail.text, /Muse 登录账号/); assert.match(mail.text, /邮箱密码：mailpass/); assert.match(mail.text, /邮箱验证码获取地址/);
    assert.equal((await call("/api/admin/send-delivery", { id: account.id, card: "OTHER" }, session)).status, 409);
    assert.equal((await call("/api/admin/supplier-deliver", { id: account.id }, session)).status, 409);
    const manual = (await call("/api/orders", { product: "muse", email: "manual@example.com", method: "alipay", acceptedTerms: true, requestId: randomUUID() })).data;
    await call("/api/admin/update", { id: manual.id, action: "confirm" }, session);
    await db.prepare("INSERT INTO delivery_emails(orderId,status,createdAt) VALUES(?,'sending',?)").bind(manual.id, Date.now()).run();
    assert.equal((await call("/api/admin/supplier-deliver", { id: manual.id }, session)).status, 409);
    assert.equal(supplierPurchases, before + 1);
    const catalog = await call("/api/admin/catalog", undefined, session);
    assert.ok(catalog.data.products.some(item => item.supplier === "G43844575"));
  });

  await t.test("20 元 Plus 成品账号使用指定货源及售后邮箱", async () => {
    await db.prepare("DELETE FROM rate_limits").run();
    const account = (await call("/api/orders", { product: "gpt", planId: "plusAccount", email: "plus@example.com", method: "alipay", acceptedTerms: true, requestId: randomUUID() })).data;
    assert.equal(account.amountCents, 2000);
    await call("/api/admin/update", { id: account.id, action: "confirm" }, session);
    assert.equal((await call("/api/admin/supplier-deliver", { id: account.id }, session)).status, 200);
    assert.equal(supplierGoods, "G39595340");
    const mail = sentMessages.find(item => item.to === "plus@example.com" && item.text.includes("TEST-CARD"));
    assert.ok(mail); assert.match(mail.text, /692972690@qq\.com/); assert.match(mail.text, /源头订单编号：TEST-16688/); assert.match(mail.text, /联系售后时，请提供以上源头订单编号/); assert.match(mail.html, /源头订单编号：/); assert.match(mail.html, /TEST-16688/); assert.doesNotMatch(mail.text, /3557785836/);
    const catalog = await call("/api/admin/catalog", undefined, session);
    assert.ok(catalog.data.products.some(item => item.supplier === "G39595340" && item.sales === 1));
  });

  await t.test("72 元 Plus 老号对应指定货源和售后", async () => {
    await db.prepare("DELETE FROM rate_limits").run();
    const account = (await call("/api/orders", { product: "gpt", planId: "plus15Day", email: "plus15@example.com", method: "alipay", acceptedTerms: true, requestId: randomUUID() })).data;
    assert.equal(account.amountCents, 7200);
    await call("/api/admin/update", { id: account.id, action: "confirm" }, session);
    assert.equal((await call("/api/admin/supplier-deliver", { id: account.id }, session)).status, 200);
    assert.equal(supplierGoods, "G97316889");
    const mail = sentMessages.find(item => item.to === "plus15@example.com" && item.text.includes("TEST-CARD"));
    assert.ok(mail); assert.match(mail.text, /692972690@qq\.com/); assert.match(mail.text, /源头订单编号：TEST-16688/); assert.match(mail.text, /联系售后时，请提供以上源头订单编号/); assert.match(mail.html, /源头订单编号：/); assert.match(mail.html, /TEST-16688/); assert.match(mail.text, /https:\/\/2fa\.fun\//); assert.match(mail.text, /请勿换绑/);
    const catalog = await call("/api/admin/catalog", undefined, session);
    assert.ok(catalog.data.products.some(item => item.supplier === "G97316889" && item.sales === 1));
  });

  await t.test("导入已购库存后优先发货，重复导入和发货不重复使用", async () => {
    await db.prepare("DELETE FROM rate_limits").run();
    assert.equal((await call("/api/admin/inventory-import", { tradeNo: "INVENTORY-ORDER" })).status, 401);
    assert.equal((await call("/api/admin/inventory-import", { tradeNo: "INVENTORY-ORDER" }, session)).data.added, 1);
    assert.equal((await call("/api/admin/inventory-import", { tradeNo: "INVENTORY-ORDER" }, session)).data.added, 0);
    const account = (await call("/api/orders", { product: "muse", email: "stock-buyer@example.com", method: "alipay", acceptedTerms: true, requestId: randomUUID() })).data;
    await call("/api/admin/update", { id: account.id, action: "confirm" }, session);
    const before = supplierPurchases;
    assert.equal((await call("/api/admin/supplier-deliver", { id: account.id }, session)).status, 200);
    assert.equal(supplierPurchases, before);
    assert.equal((await call("/api/admin/inventory", undefined, session)).data.available, 0);
    const history = await call(`/api/admin/delivery-history?orderId=${account.id}`, undefined, session);
    assert.equal(history.data.history[0].state, "sent");
    assert.match(history.data.history[0].text, /stock@example.com/);
    assert.equal((await call("/api/admin/supplier-deliver", { id: account.id }, session)).status, 409);
  });

  await t.test("小程序凭工作台密码登录，令牌可用且不能绕过跨站限制", async () => {
    await db.prepare("DELETE FROM rate_limits").run();
    const native = (path, method, data, headers = {}) => mf.dispatchFetch(`https://shop.example/api/admin/${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: data ? JSON.stringify(data) : undefined });
    assert.equal((await native("mini-login", "POST", { password }, { Origin: "https://evil.example" })).status, 403);
    const login = await native("mini-login", "POST", { password }); assert.equal(login.status, 200);
    const token = (await login.json()).session; assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal((await native("orders", "GET", undefined, { Authorization: `Bearer ${token}` })).status, 200);
    assert.equal((await native("logout", "POST", {}, { Authorization: `Bearer ${token}`, Origin: "https://evil.example" })).status, 403);
    assert.equal((await native("logout", "POST", {}, { Authorization: `Bearer ${token}` })).status, 200);
    assert.equal((await native("orders", "GET", undefined, { Authorization: `Bearer ${token}` })).status, 401);
  });

  await t.test("微信商店无 Origin 请求可下单，重试不重复创建且跨站请求仍被拒绝", async () => {
    await db.prepare("DELETE FROM rate_limits").run();
    const payload = { product: "muse", email: "mini@example.com", method: "wechat", acceptedTerms: true, requestId: randomUUID() };
    const native = (origin) => mf.dispatchFetch("https://shop.example/api/orders", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(payload) });
    assert.equal((await native("https://evil.example")).status, 403);
    const first = await native(); assert.equal(first.status, 201); const order = await first.json();
    const second = await native(); assert.equal(second.status, 200); assert.equal((await second.json()).id, order.id);
    const lookup = await mf.dispatchFetch("https://shop.example/api/orders/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: order.id, token: order.token }) });
    assert.equal(lookup.status, 200);
  });

  await t.test("Token 多件采购依据订单数量，不重复采购，手动核实后完成", async () => {
    supplierStock = 50;
    await db.prepare("DELETE FROM rate_limits").run();
    const order = (await call("/api/orders", {product:"muse-token",planId:"100",inviteCode:"TEST",email:"token@example.com",method:"wechat",acceptedTerms:true,requestId:randomUUID()})).data;
    assert.equal((await call("/api/admin/token-quote", {id:order.id}, session)).status,409);
    await call("/api/admin/update", {id:order.id,action:"confirm"}, session);
    const quote = await call("/api/admin/token-quote", {id:order.id}, session); assert.equal(quote.data.quantity,10);
    const before = supplierPurchases;
    assert.equal((await call("/api/admin/token-purchase", {id:order.id,expectedCents:1},session)).status,409);
    const result = await call("/api/admin/token-purchase", {id:order.id,expectedCents:Math.round(quote.data.total*100)},session);
    assert.equal(result.status,200); assert.equal(supplierGoods,"G85161614"); assert.equal(supplierQuantity,10); assert.equal(supplierRemark, `订单码:${order.code} 平台订单:${order.id}`); assert.equal(result.data.card.split("\n").length,10);
    assert.equal((await call("/api/admin/token-purchase", {id:order.id},session)).status,200); assert.equal(supplierPurchases,before+1);
    assert.equal((await call("/api/admin/update", {id:order.id,action:"complete",checked:true},session)).status,200);
  });

  await t.test("同邮箱订单时间线只对管理员开放且回复绑定订单邮箱", async () => {
    await db.prepare("DELETE FROM rate_limits").run();
    const input={product:"muse",email:"timeline@example.com",method:"wechat",acceptedTerms:true,requestId:randomUUID()};
    const first=(await call("/api/orders",input)).data;
    const second=(await call("/api/orders",{...input,requestId:randomUUID()})).data;
    assert.equal((await call("/api/admin/customer-timeline",{id:first.id})).status,401);
    const timeline=await call("/api/admin/customer-timeline",{id:first.id},session);
    assert.equal(timeline.status,200);assert.equal(timeline.data.orders.length,2);assert.equal(timeline.data.messages[1].matchedOrder,null);
    const reply=await call("/api/admin/customer-reply",{id:first.id,messageId:"mail1",message:"hello",requestId:randomUUID()},session);
    assert.equal(reply.status,200);assert.equal(sentMessages.at(-1).email,"timeline@example.com");
    assert.notEqual(first.id,second.id);
  });

  await t.test("代理仅管理员可创建，凭据不出现在管理列表中", async () => {
    await db.prepare("DELETE FROM rate_limits").run();
    const payload={name:"测试代理",password:"ExamplePassword-2026"};
    assert.equal((await call("/api/admin/agent-create",payload)).status,401);
    const created=await call("/api/admin/agent-create",payload,session);assert.equal(created.status,201);
    const list=await call("/api/admin/agents",undefined,session);assert.equal(list.status,200);
    assert.ok(list.data.agents.some(a=>a.id===created.data.id));
    assert.doesNotMatch(JSON.stringify(list.data),/ExamplePassword|passwordHash|salt/);
    assert.equal((await call("/api/admin/agent-rule",{productKey:"museAccount",amountCents:200},session)).status,200);
    assert.equal((await call("/api/admin/agent-rule",{productKey:"bad",amountCents:1},session)).status,400);
    const login=await call("/api/agent/login",{code:created.data.referralCode,password:payload.password});assert.equal(login.status,200);
    assert.equal((await call("/api/agent/me",undefined,login.cookie)).data.name,"测试代理");
    assert.equal((await call("/api/admin/agents",undefined,login.cookie)).status,401);
    assert.equal((await call(`/api/referral?code=${created.data.referralCode}`)).data.valid,true);
    assert.equal((await call("/api/referral?code=invalid")).data.valid,false);
    const checkout={product:"muse",email:"referral@example.com",method:"wechat",acceptedTerms:true,requestId:randomUUID(),referralCode:created.data.referralCode};
    const orders=await Promise.all([call("/api/orders",checkout),call("/api/orders",checkout)]);assert.equal(orders[0].data.id,orders[1].data.id);
    const attribution=await db.prepare("SELECT * FROM agent_order_attribution WHERE orderId=?").bind(orders[0].data.id).first();assert.equal(attribution.agentId,created.data.id);assert.equal(attribution.commissionCents,200);
    assert.equal((await call("/api/agent/orders")).status,401);
    const agentOrders=await call("/api/agent/orders",undefined,login.cookie);assert.equal(agentOrders.status,200);
    assert.ok(agentOrders.data.orders.some(order=>order.code===orders[0].data.code));
    assert.doesNotMatch(JSON.stringify(agentOrders.data),/referral@example.com|tokenHash|passwordHash/);
    await call("/api/admin/agent-rule",{productKey:"museAccount",amountCents:400},session);
    assert.equal((await db.prepare("SELECT commissionCents FROM agent_order_attribution WHERE orderId=?").bind(orders[0].data.id).first()).commissionCents,200);
    assert.equal((await call("/api/admin/agent-status",{id:created.data.id,status:"disabled"},session)).status,200);
    assert.equal((await call(`/api/referral?code=${created.data.referralCode}`)).data.valid,false);
    const disabledOrder=(await call("/api/orders",{...checkout,requestId:randomUUID()})).data;
    assert.equal(await db.prepare("SELECT * FROM agent_order_attribution WHERE orderId=?").bind(disabledOrder.id).first(),null);
    assert.equal((await call("/api/agent/me",undefined,login.cookie)).status,401);
  });

});
