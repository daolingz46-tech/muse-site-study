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
  status: string; stage: string; ref: string; messageId: number | null;
  snapshot: string; pinned: number; contactedAt: number | null;
};
type Update = {
  message?: { chat?: { id?: number; type?: string }; from?: { id?: number }; text?: string };
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

function messagePayload(order: Order, callbacks: boolean) {
  const openLabel = order.status === "reported" ? "打开订单核款" : order.stage === "processing" ? "打开订单发货" : "打开订单";
  const inline_keyboard: { text: string; url?: string; callback_data?: string }[][] = [
    [{ text: openLabel, url: `${workbench}#order=${order.ref}` }],
  ];
  if (callbacks && order.status === "processing" && !order.contactedAt) {
    inline_keyboard.push([{ text: "标记已联系", callback_data: `contact:${order.ref}` }]);
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
  const db = env.DB;
  const now = Date.now();
  const leaseUntil = now + 240_000;
  await db.prepare("INSERT OR IGNORE INTO telegram_order_chats(chatId,startedAt) VALUES(?,?)").bind(bot.chatId, startedAt).run();
  const claim = await db.prepare("UPDATE telegram_order_chats SET leaseUntil=? WHERE chatId=? AND leaseUntil<=? RETURNING startedAt")
    .bind(leaseUntil, bot.chatId, now).first<{ startedAt: number }>();
  if (!claim) return;
  const callbacks = Boolean(env.TELEGRAM_WEBHOOK_SECRET);
  try {
    const rows = await db.prepare(`SELECT o.id, o.code, o.title, o.amountCents, o.method, o.status, o.stage,
      m.ref, m.messageId, m.snapshot, m.pinned, m.contactedAt
      FROM telegram_order_status o
      LEFT JOIN telegram_order_messages m ON m.chatId=? AND m.orderId=o.id
      WHERE o.updatedAt>=? AND COALESCE(m.retryAt,0)<=?
      AND (m.orderId IS NOT NULL OR o.createdAt>=? OR o.status IN ('reported','processing'))
      AND (m.messageId IS NULL OR m.snapshot != o.stage || ':' || COALESCE(m.contactedAt,0) || ':' || ?)
      ORDER BY CASE WHEN o.status IN ('reported','processing') THEN 0 ELSE 1 END, o.updatedAt, o.id LIMIT 20`)
      .bind(bot.chatId, claim.startedAt, now, claim.startedAt, Number(callbacks)).all<Order>();
    for (const order of rows.results) {
      if (Date.now() > leaseUntil - 30_000) break;
      if (!order.ref) {
        order.ref = crypto.randomUUID().replaceAll("-", "");
        await db.prepare("INSERT INTO telegram_order_messages(chatId,orderId,ref) VALUES(?,?,?)").bind(bot.chatId, order.id, order.ref).run();
      }
      const payload = messagePayload(order, callbacks);
      const snapshot = `${order.stage}:${order.contactedAt || 0}:${Number(callbacks)}`;
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
        if (order.snapshot && alertStages.has(order.stage) && !order.snapshot.startsWith(order.stage + ":")) {
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

export async function telegramOrderWebhook(env: TelegramOrderEnv, request: Request) {
  const bot = configuredBot(env);
  if (!bot || !env.TELEGRAM_WEBHOOK_SECRET) return new Response(null, { status: 404 });
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response(null, { status: 403 });
  }
  const update = await request.json().catch(() => null) as Update | null;
  const event = update?.callback_query || update?.message;
  const chat = update?.callback_query ? update.callback_query.message?.chat : update?.message?.chat;
  if (chat?.type !== "private" || String(chat.id) !== bot.chatId || String(event?.from?.id) !== bot.chatId) {
    return new Response(null, { status: 204 });
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
        [{ text: "查看待核款", url: `${workbench}#status=reported` }, { text: "查看待发货", url: `${workbench}#status=delivery` }],
        [{ text: "查看异常", url: `${workbench}#status=attention` }],
      ] },
    });
  }
  const callback = update?.callback_query;
  const ref = callback?.data?.match(/^contact:([0-9a-f]{32})$/)?.[1];
  if (callback && ref && callback.message?.message_id) {
    const mark = await env.DB.prepare(`UPDATE telegram_order_messages SET contactedAt=COALESCE(contactedAt,?)
      WHERE chatId=? AND ref=? AND messageId=? AND EXISTS
      (SELECT 1 FROM orders WHERE id=orderId AND status='processing')
      RETURNING orderId`).bind(Date.now(), bot.chatId, ref, callback.message.message_id).first();
    await telegram(bot, "answerCallbackQuery", { chat_id: undefined, callback_query_id: callback.id, text: mark ? "已记录联系状态" : "订单状态已变化，请刷新工作台" });
  }
  return new Response(null, { status: callback && ref ? 200 : 204 });
}
