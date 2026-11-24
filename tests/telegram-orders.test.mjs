import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { syncTelegramOrders, telegramOrderWebhook } from "../worker/telegram-orders.ts";

test("Telegram order messages, alerts, owner actions and recovery", async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: "telegram-test", modules: true, script: "export default {}",
    compatibilityDate: "2026-10-01", d1Databases: { DB: "telegram-test" },
  }] }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  for (const file of ["0001_orders", "0007_delivery_tutorial", "0009_supplier_fulfillment", "0010_stock_notice", "0026_telegram_orders"]) {
    for (const sql of readFileSync(new URL("../migrations/" + file + ".sql", import.meta.url), "utf8").split(";")) {
      if (sql.trim()) await db.prepare(sql).run();
    }
  }
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "fixture", TELEGRAM_OWNER_CHAT_ID: "42", TELEGRAM_WEBHOOK_SECRET: "fixture-secret" };
  const events = [];
  let failEdit = false;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const method = new URL(url).pathname.split("/").at(-1);
    const payload = JSON.parse(options.body);
    events.push({ method, payload });
    if (failEdit && method === "editMessageText") return Response.json({ ok: false, description: "temporary test error" }, { status: 502 });
    return Response.json({ ok: true, result: method === "sendMessage" ? { message_id: 123 } : true });
  });
  const now = Date.now();
  const insert = async (id, createdAt) => db.prepare(
    "INSERT INTO orders(id,requestHash,inputHash,tokenHash,code,product,title,amountCents,target,method,createdAt,expiresAt,updatedAt) VALUES(?,?,?,?,?,'muse','测试商品',11900,'private@example.test','alipay',?,?,?)",
  ).bind(id, id, "input", "secret", id === "historical" ? "0456" : "0123", createdAt, now + 60_000, createdAt).run();
  const change = status => db.prepare("UPDATE orders SET status=?,updatedAt=? WHERE id='private-order'").bind(status, Date.now()).run();
  const methods = () => events.map(event => event.method);
  const webhook = (update, secret = env.TELEGRAM_WEBHOOK_SECRET) => telegramOrderWebhook(env, new Request("https://test.example/api/telegram/orders", {
    method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify(update),
  }));

  await insert("historical", now - 60_000);
  await insert("private-order", now);
  await Promise.all([syncTelegramOrders(env, now), syncTelegramOrders(env, now)]);
  assert.deepEqual(methods(), ["sendMessage"]);
  const sent = events[0].payload;
  assert.match(sent.text, /待付款/);
  assert.equal(sent.protect_content, true);
  assert.match(sent.reply_markup.inline_keyboard[0][0].url, /#order=[0-9a-f]{32}$/);
  assert.doesNotMatch(JSON.stringify(sent), /private-order|private@example/);
  events.length = 0;

  await change("reported");
  await syncTelegramOrders(env);
  assert.deepEqual(methods(), ["editMessageText", "sendMessage"]);
  assert.equal(events[1].payload.reply_parameters.message_id, 123);
  assert.match(events[0].payload.text, /待核款/);
  assert.equal(events[0].payload.message_id, 123);
  events.length = 0;

  await change("processing");
  await syncTelegramOrders(env);
  assert.deepEqual(methods(), ["editMessageText", "pinChatMessage"]);
  const data = events[0].payload.reply_markup.inline_keyboard[1][0].callback_data;
  const callback = (id, message_id = 123) => ({
    callback_query: { id: "callback", from: { id }, data, message: { chat: { type: "private", id: 42 }, message_id } },
  });
  assert.equal((await webhook(callback(42), "wrong")).status, 403);
  assert.equal((await webhook(callback(10))).status, 204);
  await webhook(callback(42, 999));
  assert.equal((await db.prepare("SELECT contactedAt FROM telegram_order_messages").first()).contactedAt, null);
  assert.equal((await webhook(callback(42))).status, 200);
  const recorded = (await db.prepare("SELECT contactedAt FROM telegram_order_messages").first()).contactedAt;
  await webhook(callback(42));
  assert.equal((await db.prepare("SELECT contactedAt FROM telegram_order_messages").first()).contactedAt, recorded);
  assert.ok(recorded > 0);
  events.length = 0;

  await db.prepare("INSERT INTO supplier_fulfillment(orderId,state,updatedAt) VALUES('private-order','purchase_unknown',?)").bind(now).run();
  await syncTelegramOrders(env);
  assert.deepEqual(methods(), ["editMessageText", "sendMessage"]);
  assert.match(events[0].payload.text, /采购结果待核查[\s\S]*已联系/);
  await webhook({ message: { chat: { type: "private", id: 42 }, from: { id: 42 }, text: "/todo" } });
  assert.match(events[2].payload.text, /待发货 0 笔[\s\S]*异常 1 笔/);
  events.length = 0;

  await change("complete");
  failEdit = true;
  t.mock.method(console, "error", () => {});
  await syncTelegramOrders(env);
  await syncTelegramOrders(env);
  assert.deepEqual(methods(), ["editMessageText"]);
  await db.prepare("UPDATE telegram_order_messages SET retryAt=0").run();
  failEdit = false;
  events.length = 0;
  await syncTelegramOrders(env);
  await syncTelegramOrders(env);
  assert.deepEqual(methods(), ["editMessageText", "unpinChatMessage"]);
  assert.match(events[0].payload.text, /已交付/);
});
