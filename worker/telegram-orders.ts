import type { D1Database } from "@cloudflare/workers-types";

export type TelegramOrderEnv = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_OWNER_CHAT_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
};

type Bot = { token: string; chatId: string };
type Order = {
  id: string; code: string; title: string; amountCents: number; method: string;
  status: string; stage: string; ref: string; messageId: number | null; canEmail: number;
  snapshot: string; pinned: number; contactedAt: number | null;
};
type Update = {
  message?: { chat?: { id?: number; type?: string }; from?: { id?: number }; text?: string; message_id?: number; reply_to_message?: { message_id?: number } };
  callback_query?: {
    id: string; from?: { id?: number }; data?: string;
    message?: { chat?: { id?: number; type?: string }; message_id?: number };
  };
};

const workbench = "https://musetoken.store/admin/";
const stages: Record<string, string> = {
  pending: "🆕 新订单 · 待付款",
  reported: "💰 待核款",
  processing: "📦 待发货",
  awaiting_supplier: "⏳ 等待货源发货",
  purchase_unknown: "⚠️ 采购结果待核查",
  mail_unknown: "⚠️ 邮件发送结果待核查",
  stock_issue: "⚠️ 缺货待处理",
  complete: "✅ 已交付",
  expired: "⌛ 订单已超时",
  cancelled: "❌ 订单已取消",
};

const alertStages = new Set(["reported", "purchase_unknown", "mail_unknown", "stock_issue"]);

function configuredBot(env: TelegramOrderEnv): Bot | null {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_OWNER_CHAT_ID;
  return token && /^[1-9]\d{0,15}$/.test(chatId || "") ? { token, chatId: chatId! } : null;
}

class TelegramError extends Error {
  readonly description: string;
  readonly retryAfter: number;

  constructor(description: string, retryAfter: number) {
    super("telegram_api_error");
    this.description = description;
    this.retryAfter = retryAfter;
  }
}

async function telegram<T>(bot: Bot, method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${bot.token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: bot.chatId, ...payload }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json() as { ok: boolean; result: T; description?: string; parameters?: { retry_after?: number } };
  if (!response.ok || !data.ok) throw new TelegramError(data.description || "", data.parameters?.retry_after || 0);
  return data.result;
}

async function updateMessage(bot: Bot, method: string, payload: Record<string, unknown>, alreadyDone: string) {
  try { await telegram(bot, method, payload); }
  catch (error) {
    if (!(error instanceof TelegramError && error.description.toLowerCase().includes(alreadyDone))) throw error;
  }
}

type OrderButton = { text: string; url?: string; callback_data?: string };

function messagePayload(order: Order, callbacks: boolean) {
  const openLabel = order.status === "reported" ? "打开订单核款" : order.stage === "processing" ? "打开订单发货" : "打开订单";
  const inline_keyboard: OrderButton[][] = [
    [callbacks ? { text: openLabel, callback_data: `order:${order.ref}` } : { text: openLabel, url: `${workbench}#order=${order.ref}` }],
  ];
  if (callbacks && order.status === "processing" && !order.contactedAt) {
    inline_keyboard.push([{ text: "标记已联系", callback_data: `contact:${order.ref}` }]);
  }
  if (callbacks && order.canEmail) {
    inline_keyboard.push([{ text: "手动邮件发货", callback_data: `mail:${order.ref}` }]);
  }
  const amount = (order.amountCents / 100).toFixed(2);
  const payment = order.method === "alipay" ? "支付宝" : "微信支付";
  return {
    text: [stages[order.stage], order.title.replace(/\s+/g, " ").slice(0, 160),
      `¥${amount} · ${payment} · 订单码 ${order.code}`, order.contactedAt ? "☎️ 已联系" : ""].filter(Boolean).join("\n"),
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard },
  };
}

export async function syncTelegramOrders(env: TelegramOrderEnv, startedAt = Date.now()) {
  const bot = configuredBot(env);
  if (!bot) return;
  await Promise.all([
    syncOwnerOrders(env, bot, startedAt),
    syncPartnerOrders(env, bot),
  ]);
}

async function syncPartnerOrders(env: TelegramOrderEnv, owner: Bot) {
  const db = env.DB;
  const { results: partners } = await db.prepare("SELECT chatId,approvedAt,role FROM telegram_delivery_partners")
    .all<{ chatId: string; approvedAt: number; role: string }>();
  await Promise.all(partners.map(async ({ chatId, approvedAt, role }) => {
    const bot = { ...owner, chatId };
    if (role === "admin") return syncOwnerOrders(env, bot, approvedAt, true);
    const now = Date.now(), leaseUntil = now + 240_000;
    await db.prepare("INSERT OR IGNORE INTO telegram_order_chats(chatId,startedAt) VALUES(?,?)").bind(chatId, approvedAt).run();
    const claim = await db.prepare("UPDATE telegram_order_chats SET leaseUntil=? WHERE chatId=? AND leaseUntil<=? RETURNING chatId")
      .bind(leaseUntil, chatId, now).first();
    if (!claim) return;
    try {
      const { results: orders } = await db.prepare(`SELECT o.id,o.code,o.title,o.status
        FROM orders o LEFT JOIN telegram_order_messages m ON m.chatId=? AND m.orderId=o.id
        WHERE o.updatedAt>=? AND COALESCE(m.retryAt,0)<=?
        AND (o.status IN ('pending','reported') OR (o.status='processing' AND o.product IN ('muse','gpt')))
        AND COALESCE(m.snapshot,'') != 'partner:' || o.status
        ORDER BY CASE o.status WHEN 'reported' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END,o.updatedAt,o.id LIMIT 20`)
        .bind(chatId, approvedAt, now).all<{ id: string; code: string; title: string; status: string }>();
      for (const order of orders) {
        if (Date.now() > leaseUntil - 30_000) break;
        if (!await db.prepare("SELECT 1 FROM telegram_delivery_partners WHERE chatId=? AND approvedAt=? AND role='delivery'").bind(chatId, approvedAt).first()) break;
        await db.prepare("INSERT OR IGNORE INTO telegram_order_messages(chatId,orderId,ref) VALUES(?,?,?)")
          .bind(chatId, order.id, crypto.randomUUID().replaceAll("-", "")).run();
        try {
          await telegram(bot, "sendMessage", {
            text: [stages[order.status], order.title.replace(/\s+/g, " ").slice(0, 160), `订单码 ${order.code}`].join("\n"),
            protect_content: true,
            ...(order.status === "processing" ? { reply_markup: { inline_keyboard: [[
              { text: "查看待发货订单", callback_data: `todo:${order.code}` },
            ]] } } : {}),
          });
          await db.prepare("UPDATE telegram_order_messages SET snapshot=?,retryAt=0 WHERE chatId=? AND orderId=?")
            .bind(`partner:${order.status}`, chatId, order.id).run();
        } catch (error) {
          const retryAfter = error instanceof TelegramError ? error.retryAfter : 0;
          await db.prepare("UPDATE telegram_order_messages SET retryAt=? WHERE chatId=? AND orderId=?")
            .bind(Date.now() + Math.max(60, retryAfter) * 1000, chatId, order.id).run();
          console.error("telegram_partner_notification_failed");
          if (retryAfter) break;
        }
      }
    } finally {
      await db.prepare("UPDATE telegram_order_chats SET leaseUntil=0 WHERE chatId=? AND leaseUntil=?").bind(chatId, leaseUntil).run();
    }
  }));
}

async function syncOwnerOrders(env: TelegramOrderEnv, bot: Bot, startedAt: number, delegated = false) {
  const db = env.DB;
  const now = Date.now();
  const leaseUntil = now + 240_000;
  await db.prepare("INSERT OR IGNORE INTO telegram_order_chats(chatId,startedAt) VALUES(?,?)").bind(bot.chatId, startedAt).run();
  const claim = await db.prepare("UPDATE telegram_order_chats SET leaseUntil=? WHERE chatId=? AND leaseUntil<=? RETURNING startedAt")
    .bind(leaseUntil, bot.chatId, now).first<{ startedAt: number }>();
  if (!claim) return;
  const callbacks = Boolean(env.TELEGRAM_WEBHOOK_SECRET);
  try {
    await db.prepare("DELETE FROM telegram_delivery_drafts WHERE expiresAt<=?").bind(now).run();
    const rows = await db.prepare(`SELECT o.id, o.code, o.title, o.amountCents, o.method, o.status, o.stage,
      m.ref, CASE WHEN ?=1 AND (m.snapshot='' OR m.snapshot LIKE 'partner:%') THEN NULL ELSE m.messageId END AS messageId,
      m.snapshot, m.pinned, m.contactedAt,
      (o.stage IN ('processing','stock_issue') AND EXISTS
        (SELECT 1 FROM orders WHERE id=o.id AND product IN ('gpt','muse'))) AS canEmail
      FROM telegram_order_status o
      LEFT JOIN telegram_order_messages m ON m.chatId=? AND m.orderId=o.id
      WHERE o.updatedAt>=? AND COALESCE(m.retryAt,0)<=?
      AND (m.orderId IS NOT NULL OR o.createdAt>=? OR o.status IN ('reported','processing'))
      AND (m.messageId IS NULL OR m.snapshot != o.stage || ':' || COALESCE(m.contactedAt,0) || ':' || ? || ':chat')
      ORDER BY CASE WHEN o.status IN ('reported','processing') THEN 0 ELSE 1 END, o.updatedAt, o.id LIMIT 20`)
      .bind(Number(delegated), bot.chatId, delegated ? Math.max(startedAt, claim.startedAt) : claim.startedAt, now, claim.startedAt, Number(callbacks)).all<Order>();
    for (const order of rows.results) {
      if (Date.now() > leaseUntil - 30_000) break;
      if (delegated && !await db.prepare("SELECT 1 FROM telegram_delivery_partners WHERE chatId=? AND role='admin'").bind(bot.chatId).first()) break;
      if (!order.ref) {
        order.ref = crypto.randomUUID().replaceAll("-", "");
        await db.prepare("INSERT INTO telegram_order_messages(chatId,orderId,ref) VALUES(?,?,?)").bind(bot.chatId, order.id, order.ref).run();
      }
      const payload = messagePayload(order, callbacks);
      const snapshot = `${order.stage}:${order.contactedAt || 0}:${Number(callbacks)}:chat`;
      const pinned = order.status === "processing";
      try {
        if (order.messageId === null) {
          const result = await telegram<{ message_id: number }>(bot, "sendMessage", { ...payload, protect_content: true });
          order.messageId = result.message_id;
          await db.prepare("UPDATE telegram_order_messages SET messageId=? WHERE chatId=? AND orderId=?")
            .bind(order.messageId, bot.chatId, order.id).run();
        } else if (snapshot !== order.snapshot) {
          await updateMessage(bot, "editMessageText", { ...payload, message_id: order.messageId }, "message is not modified");
        }
        if (pinned !== Boolean(order.pinned)) {
          await updateMessage(bot, pinned ? "pinChatMessage" : "unpinChatMessage", {
            message_id: order.messageId, ...(pinned ? { disable_notification: true } : {}),
          }, pinned ? "message is already pinned" : "message is not pinned");
        }
        if (order.snapshot && !order.snapshot.startsWith("partner:") && alertStages.has(order.stage) && !order.snapshot.startsWith(order.stage + ":")) {
          await telegram(bot, "sendMessage", {
            text: `${stages[order.stage]} · 订单码 ${order.code}`,
            reply_parameters: { message_id: order.messageId, allow_sending_without_reply: true },
            protect_content: true,
            reply_markup: { inline_keyboard: [payload.reply_markup.inline_keyboard[0]] },
          });
        }
        await db.prepare("UPDATE telegram_order_messages SET snapshot=?,pinned=?,retryAt=0 WHERE chatId=? AND orderId=?")
          .bind(snapshot, Number(pinned), bot.chatId, order.id).run();
      } catch (error) {
        const delay = error instanceof TelegramError ? error.retryAfter : 0;
        if (error instanceof TelegramError && error.description.toLowerCase().includes("message to edit not found")) {
          await db.prepare("UPDATE telegram_order_messages SET messageId=NULL,snapshot='',pinned=0 WHERE chatId=? AND orderId=?")
            .bind(bot.chatId, order.id).run();
        }
        await db.prepare("UPDATE telegram_order_messages SET retryAt=? WHERE chatId=? AND orderId=?")
          .bind(Date.now() + Math.max(delay, 60) * 1000, bot.chatId, order.id).run();
        console.error("telegram_order_sync_failed");
        if (delay) break;
      }
    }
  } finally {
    await db.prepare("UPDATE telegram_order_chats SET leaseUntil=0 WHERE chatId=? AND leaseUntil=?").bind(bot.chatId, leaseUntil).run();
  }
}

type ManualDelivery = (input: Record<string, unknown>) => Promise<string>;
type UpdateOrder = (id: string, action: "confirm" | "complete") => Promise<string>;

const queues = {
  reported: { label: "待核款", filter: "o.status='reported'" },
  delivery: { label: "待发货", filter: "o.status='processing' AND o.stage NOT IN ('purchase_unknown','mail_unknown','stock_issue')" },
  attention: { label: "异常", filter: "o.stage IN ('purchase_unknown','mail_unknown','stock_issue')" },
};

async function showAdminQueue(db: D1Database, bot: Bot, key: keyof typeof queues, page: number) {
  const queue = queues[key];
  const { results } = await db.prepare(`SELECT o.id,o.code,o.title FROM telegram_order_status o
    WHERE ${queue.filter} ORDER BY o.updatedAt,o.id LIMIT 9 OFFSET ?`).bind(page * 8)
    .all<{ id: string; code: string; title: string }>();
  const orders = results.slice(0, 8);
  const keyboard: OrderButton[][] = [];
  if (orders.length) {
    await db.batch(orders.map(order => db.prepare("INSERT OR IGNORE INTO telegram_order_messages(chatId,orderId,ref) VALUES(?,?,?)")
      .bind(bot.chatId, order.id, crypto.randomUUID().replaceAll("-", ""))));
    const { results: rows } = await db.prepare(`SELECT orderId,ref FROM telegram_order_messages
      WHERE chatId=? AND orderId IN (${orders.map(() => "?").join(",")})`)
      .bind(bot.chatId, ...orders.map(order => order.id)).all<{ orderId: string; ref: string }>();
    const refs = new Map(rows.map(row => [row.orderId, row.ref]));
    for (const order of orders) keyboard.push([{
      text: `${order.code} · ${order.title.replace(/\s+/g, " ").slice(0, 40)}`,
      callback_data: `order:${refs.get(order.id)}`,
    }]);
  }
  const navigation: OrderButton[] = [];
  if (page > 0) navigation.push({ text: "上一页", callback_data: `queue:${key}:${page-1}` });
  if (results.length > 8) navigation.push({ text: "下一页", callback_data: `queue:${key}:${page+1}` });
  if (navigation.length) keyboard.push(navigation);
  await telegram(bot, "sendMessage", {
    text: orders.length ? `${queue.label}订单 · 第 ${page + 1} 页` : `当前没有${queue.label}订单。`,
    protect_content: true, reply_markup: { inline_keyboard: keyboard },
  });
}

async function handleAdminOrderActions(db: D1Database, bot: Bot, callback: NonNullable<Update["callback_query"]>, updateOrder: UpdateOrder) {
  const queue = callback.data?.match(/^queue:(reported|delivery|attention):(\d{1,5})$/);
  const command = callback.data?.match(/^(order|paid|charged):([0-9a-f]{32})$/);
  if (!queue && !command) return false;
  await telegram(bot, "answerCallbackQuery", { chat_id: undefined, callback_query_id: callback.id });
  if (queue) {
    await showAdminQueue(db, bot, queue[1] as keyof typeof queues, Number(queue[2]));
    return true;
  }
  const [, action, ref] = command!;
  const order = await db.prepare(`SELECT o.id,o.code,o.title,o.amountCents,o.method,o.status,o.stage,
      base.product, base.target, m.contactedAt,
      NOT EXISTS(SELECT 1 FROM supplier_fulfillment WHERE orderId=o.id)
      AND NOT EXISTS(SELECT 1 FROM delivery_emails WHERE orderId=o.id) AS manualEmail
    FROM telegram_order_messages m JOIN telegram_order_status o ON o.id=m.orderId
    JOIN orders base ON base.id=o.id WHERE m.chatId=? AND m.ref=?`)
    .bind(bot.chatId, ref).first<{ id: string; code: string; title: string; amountCents: number; method: string; status: string; stage: string; product: string; target: string; contactedAt: number | null; manualEmail: number }>();
  const reply = (text: string, keyboard: OrderButton[][] = []) => telegram(bot, "sendMessage", {
    text, protect_content: true, reply_markup: { inline_keyboard: keyboard },
  });
  if (!order) { await reply("订单不存在或消息已失效，请发 /todo 重新查看。"); return true; }
  if (action !== "order") {
    if ((action === "paid" && order.status !== "reported") || (action === "charged" && (order.status !== "processing" || order.product !== "muse-token"))) {
      await reply("订单状态已变化，请重新查看。", [[{ text: "查看最新状态", callback_data: `order:${ref}` }]]);
      return true;
    }
    await reply(await updateOrder(order.id, action === "paid" ? "confirm" : "complete"), [[{ text: "查看最新状态", callback_data: `order:${ref}` }]]);
    return true;
  }
  const rows: OrderButton[][] = [];
  const lines = [stages[order.stage], order.title.replace(/\s+/g, " ").slice(0, 160),
    `订单码 ${order.code} · ¥${(order.amountCents / 100).toFixed(2)} · ${order.method === "alipay" ? "支付宝" : "微信支付"}`];
  if (order.status === "reported") {
    lines.push("请核对实际到账和付款备注后，再确认收款。");
    rows.push([{ text: "确认已到账", callback_data: `paid:${ref}` }]);
  }
  if (order.status === "processing") {
    if (order.product === "muse-token") {
      lines.push(`Muse 邀请码：${order.target}`);
      if (order.stage === "processing") rows.push([{ text: "确认充值已到账", callback_data: `charged:${ref}` }]);
    } else if (order.manualEmail) {
      rows.push([{ text: "手动邮件发货", callback_data: `mail:${ref}` }]);
    }
    if (!order.contactedAt) rows.push([{ text: "标记已联系", callback_data: `mark:${ref}` }]);
  }
  await reply(lines.join("\n"), rows);
  return true;
}

async function showPartnerOrders(db: D1Database, bot: Bot, code: string) {
  const { results } = await db.prepare(`SELECT o.id,o.code,o.title FROM orders o
    WHERE o.status='processing' AND o.product IN ('muse','gpt') AND (?='' OR o.code=?)
    AND NOT EXISTS (SELECT 1 FROM supplier_fulfillment WHERE orderId=o.id)
    AND NOT EXISTS (SELECT 1 FROM delivery_emails WHERE orderId=o.id)
    ORDER BY o.paidAt,o.id LIMIT 11`).bind(code, code).all<{ id: string; code: string; title: string }>();
  if (!results.length) {
    await telegram(bot, "sendMessage", { text: "没有可手动邮件发货的订单。", protect_content: true });
    return;
  }
  const orders = results.slice(0, 10);
  await db.batch(orders.map(order => db.prepare("INSERT OR IGNORE INTO telegram_order_messages(chatId,orderId,ref) VALUES(?,?,?)")
    .bind(bot.chatId, order.id, crypto.randomUUID().replaceAll("-", ""))));
  const { results: messages } = await db.prepare(`SELECT orderId,ref FROM telegram_order_messages
    WHERE chatId=? AND orderId IN (${orders.map(() => "?").join(",")})`)
    .bind(bot.chatId, ...orders.map(order => order.id)).all<{ orderId: string; ref: string }>();
  const refs = new Map(messages.map(row => [row.orderId, row.ref]));
  const menu = await telegram<{message_id: number}>(bot, "sendMessage", {
    text: "待邮件发货 · 请选择订单。可发 /todo 加 4 位订单码查询指定订单。",
    protect_content: true,
    reply_markup: { inline_keyboard: orders.map(order => [{
      text: `${order.code} · ${order.title.replace(/\s+/g, " ").slice(0, 40)}`,
      callback_data: `mail:${refs.get(order.id)}`,
    }]) },
  });
  await db.batch(orders.map(order => db.prepare("UPDATE telegram_order_messages SET messageId=? WHERE chatId=? AND orderId=?")
    .bind(menu.message_id, bot.chatId, order.id)));
}

async function handleDeliveryDraft(db: D1Database, bot: Bot, update: Update, sendDelivery: ManualDelivery, admin: boolean) {
  const callback = update.callback_query;
  const action = callback?.data?.match(/^(mail|send|cancel):([0-9a-f]{32})$/);
  const now = Date.now();
  const say = (text: string, reply_markup?: Record<string, unknown>) => telegram<{ message_id: number }>(bot, "sendMessage", { text, protect_content: true, reply_markup });
  if (callback && action) {
    const [, kind, ref] = action;
    await telegram(bot, "answerCallbackQuery", { chat_id: undefined, callback_query_id: callback.id });
    if (kind === "mail") {
      const order = await db.prepare(`SELECT o.id, o.code, o.product FROM telegram_order_messages m
        JOIN orders o ON o.id=m.orderId
        WHERE m.chatId=? AND m.ref=? AND (m.messageId=? OR ?=1) AND o.status='processing'
        AND o.product IN ('muse','gpt')
        AND NOT EXISTS (SELECT 1 FROM supplier_fulfillment WHERE orderId=o.id)
        AND NOT EXISTS (SELECT 1 FROM delivery_emails WHERE orderId=o.id)`)
        .bind(bot.chatId, ref, callback.message?.message_id ?? 0, Number(admin)).first<{id: string; code: string; product: string}>();
      if (!order) { await say("这笔订单暂不能手动邮件发货。请在工作台核查订单状态。"); return true; }
      const prompt = await say(order.product === "gpt"
        ? `订单 ${order.code} · 回复这条消息。第一行写实际采购货源编号（无编号的自定义商品填「手工交付」），下一行起粘贴卡密。需要补充教程时，空一行后填写。`
        : `订单 ${order.code} · 回复这条消息，粘贴要发给买家的账号或卡密。系统会附上对应的默认教程。`,
      { force_reply: true, input_field_placeholder: "填写发货资料" });
      await db.prepare(`INSERT INTO telegram_delivery_drafts(chatId,ref,orderId,promptId,expiresAt)
        VALUES(?,?,?,?,?) ON CONFLICT(chatId) DO UPDATE SET
        ref=excluded.ref,orderId=excluded.orderId,promptId=excluded.promptId,expiresAt=excluded.expiresAt,payload=NULL`)
        .bind(bot.chatId, crypto.randomUUID().replaceAll("-", ""), order.id, prompt.message_id, now + 600_000).run();
      return true;
    }
    if (kind === "cancel") {
      const removed = await db.prepare("DELETE FROM telegram_delivery_drafts WHERE chatId=? AND ref=?").bind(bot.chatId, ref).run();
      if (removed.meta.changes) await say("已取消，邮件未发送。");
      return true;
    }
    const draft = await db.prepare(`DELETE FROM telegram_delivery_drafts WHERE chatId=? AND ref=?
      AND expiresAt>? AND payload IS NOT NULL RETURNING payload`).bind(bot.chatId, ref, now).first<{payload: string}>();
    if (!draft) { await say("这份发货内容已处理或已过期，请查看订单状态。"); return true; }
    await say(await sendDelivery(JSON.parse(draft.payload)));
    return true;
  }
  const message = update.message;
  const promptId = message?.reply_to_message?.message_id;
  if (!message?.text || !promptId) return false;
  const draft = await db.prepare(`SELECT d.ref,d.orderId,o.code,o.product FROM telegram_delivery_drafts d
    JOIN orders o ON o.id=d.orderId WHERE d.chatId=? AND d.promptId=? AND d.expiresAt>? AND d.payload IS NULL`)
    .bind(bot.chatId, promptId, now).first<{ref: string; orderId: string; code: string; product: string}>();
  if (!draft) return false;
  const raw = message.text.trim();
  const firstLine = raw.indexOf("\n");
  const goodsNo = draft.product === "gpt" ? raw.slice(0, Math.max(0, firstLine)).trim() : "";
  const content = draft.product === "gpt" ? raw.slice(firstLine + 1).trim() : raw;
  const separator = draft.product === "gpt" ? content.search(/\r?\n\r?\n/) : -1;
  const card = separator >= 0 ? content.slice(0, separator).trim() : content;
  const instructions = separator >= 0 ? content.slice(separator).trim() : "";
  if (!card || card.length > 4000 || instructions.length > 2000 || (draft.product === "gpt" && !/^(G\d+|手工交付)$/.test(goodsNo))) {
    await say("内容格式不正确，请按下单商品的提示重新回复发货资料。");
    return true;
  }
  const pending = await db.prepare("UPDATE telegram_delivery_drafts SET payload=? WHERE chatId=? AND ref=? AND payload IS NULL")
    .bind(JSON.stringify({ id: draft.orderId, card, goodsNo, instructions }), bot.chatId, draft.ref).run();
  if (!pending.meta.changes) return true;
  if (message.message_id) await telegram(bot, "deleteMessage", { message_id: message.message_id }).catch(() => {});
  await say(`订单 ${draft.code} 的发货资料已收到。确认后会发到买家下单邮箱。`, {
    inline_keyboard: [[{ text: "确认发送", callback_data: `send:${draft.ref}` }, { text: "取消", callback_data: `cancel:${draft.ref}` }]],
  });
  return true;
}

export async function telegramOrderWebhook(env: TelegramOrderEnv, request: Request, sendDelivery?: ManualDelivery, createAdminLink?: (chatId: string, destination: string) => Promise<string | null>, updateOrder?: UpdateOrder) {
  const owner = configuredBot(env);
  if (!owner || !env.TELEGRAM_WEBHOOK_SECRET) return new Response(null, { status: 404 });
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response(null, { status: 403 });
  }
  const update = await request.json().catch(() => null) as Update | null;
  const event = update?.callback_query || update?.message;
  const chat = update?.callback_query ? update.callback_query.message?.chat : update?.message?.chat;
  const chatId = String(chat?.id);
  if (chat?.type !== "private" || !/^[1-9]\d{0,15}$/.test(chatId) || String(event?.from?.id) !== chatId) {
    return new Response(null, { status: 204 });
  }
  const bot = { ...owner, chatId };
  const command = update?.message?.text?.trim() || "";
  const isOwner = chatId === owner.chatId;
  const partner = isOwner ? null : await env.DB.prepare("SELECT role FROM telegram_delivery_partners WHERE chatId=?").bind(chatId).first<{ role: string }>();
  const delegated = partner?.role === "admin";
  if (!isOwner) {
    if (!partner) {
      if (command === "/start") await telegram(bot, "sendMessage", {
        text: `这个 Bot 需要店主授权。请把你的 Telegram ID 发给店主：${chatId}`,
        protect_content: true,
      });
      return new Response(null, { status: 204 });
    }
    const todo = command.match(/^\/todo(?:\s+(\d{4}))?$/);
    const todoButton = update?.callback_query?.data?.match(/^todo:(\d{4})$/);
    if (!delegated && (command === "/start" || todo || todoButton)) {
      if (todoButton && update?.callback_query) await telegram(bot, "answerCallbackQuery", {
        chat_id: undefined, callback_query_id: update.callback_query.id,
      });
      await showPartnerOrders(env.DB, bot, todo?.[1] || todoButton?.[1] || "");
      return new Response(null, { status: 200 });
    }
  }
  if (isOwner || delegated) {
    const manage = command.match(/^\/(allow|revoke)\s+([1-9]\d{0,15})$/);
    if (manage) {
      const [, action, partnerId] = manage;
      if (action === "allow" && partnerId !== owner.chatId) await env.DB.prepare(
        "INSERT OR IGNORE INTO telegram_delivery_partners(chatId,approvedAt) VALUES(?,?)",
      ).bind(partnerId, Date.now()).run();
      if (action === "revoke") await env.DB.batch([
        env.DB.prepare("DELETE FROM sessions WHERE telegramChatId=?").bind(partnerId),
        env.DB.prepare("DELETE FROM telegram_delivery_partners WHERE chatId=?").bind(partnerId),
        env.DB.prepare("DELETE FROM telegram_delivery_drafts WHERE chatId=?").bind(partnerId),
      ]);
      await telegram(bot, "sendMessage", {
        text: action === "allow" ? `已授权 ${partnerId} 查看待邮件发货订单并发送交付邮件。请让对方再发 /start。` : `已撤销 ${partnerId} 的 Bot 和工作台权限。`,
        protect_content: true,
      });
      return new Response(null, { status: 200 });
    }
  }
  if (update && sendDelivery && await handleDeliveryDraft(env.DB, bot, update, sendDelivery, isOwner || delegated)) return new Response(null, { status: 200 });
  if (!isOwner && !delegated) return new Response(null, { status: 204 });

  const callback = update?.callback_query;
  if (callback && updateOrder) {
    const data = callback.data?.replace(/^web:order=/, "order:").replace(/^web:status=(reported|delivery|attention)$/, "queue:$1:0");
    if (await handleAdminOrderActions(env.DB, bot, { ...callback, data }, updateOrder)) return new Response(null, { status: 200 });
  }
  const openWeb = callback?.data?.match(/^web:(.*)$/);
  if (delegated && createAdminLink && (openWeb || command === "/workbench")) {
    if (callback) await telegram(bot, "answerCallbackQuery", {
      chat_id: undefined, callback_query_id: callback.id,
    });
    const destination = openWeb?.[1] || "";
    if (destination.startsWith("order=") && !await env.DB.prepare(
      "SELECT 1 FROM telegram_order_messages WHERE chatId=? AND ref=?",
    ).bind(chatId, destination.slice(6)).first()) return new Response(null, { status: 204 });
    const link = await createAdminLink(chatId, destination);
    if (link) await telegram(bot, "sendMessage", {
      text: "工作台登录链接 · 2 分钟内打开，仅可使用一次。",
      protect_content: true,
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "登录工作台", url: link }]] },
    });
    return new Response(null, { status: 200 });
  }

  if (update?.message?.text === "/todo" || update?.message?.text === "/start") {
    const counts = await env.DB.prepare(`SELECT
      COALESCE(SUM(status='reported'),0) AS reported,
      COALESCE(SUM(status='processing' AND stage NOT IN ('purchase_unknown','mail_unknown','stock_issue')),0) AS processing,
      COALESCE(SUM(stage IN ('purchase_unknown','mail_unknown','stock_issue')),0) AS attention
      FROM telegram_order_status WHERE status IN ('reported','processing')`).first<{ reported: number; processing: number; attention: number }>();
    await telegram(bot, "sendMessage", {
      text: `📋 订单待办\n待核款 ${counts?.reported || 0} 笔\n待发货 ${counts?.processing || 0} 笔\n异常 ${counts?.attention || 0} 笔`,
      protect_content: true,
      reply_markup: { inline_keyboard: [
        [{ text: "查看待核款", callback_data: "queue:reported:0" }, { text: "查看待发货", callback_data: "queue:delivery:0" }],
        [{ text: "查看异常", callback_data: "queue:attention:0" }],
      ] },
    });
  }
  const contact = callback?.data?.match(/^(contact|mark):([0-9a-f]{32})$/);
  const ref = contact?.[2];
  if (callback && ref && callback.message?.message_id) {
    const mark = await env.DB.prepare(`UPDATE telegram_order_messages SET contactedAt=COALESCE(contactedAt,?)
      WHERE chatId=? AND ref=? AND (messageId=? OR ?=1) AND EXISTS
      (SELECT 1 FROM orders WHERE id=orderId AND status='processing')
      RETURNING orderId`).bind(Date.now(), bot.chatId, ref, callback.message.message_id, Number(contact?.[1] === "mark")).first();
    await telegram(bot, "answerCallbackQuery", { chat_id: undefined, callback_query_id: callback.id, text: mark ? "已记录联系状态" : "订单状态已变化，请刷新工作台" });
  }
  return new Response(null, { status: callback && ref ? 200 : 204 });
}
