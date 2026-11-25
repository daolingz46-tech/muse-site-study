import type { D1Database } from "@cloudflare/workers-types";

const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
const ticketPattern = /^[a-f0-9]{64}$/;

export async function createTelegramAdminLink(db: D1Database, chatId: string, destination: string) {
  if (!/^(?:|status=(?:reported|delivery|attention)|order=[a-f0-9]{32})$/.test(destination)) return null;
  const now = Date.now();
  const ticket = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const [, inserted] = await db.batch([
    db.prepare("DELETE FROM telegram_admin_tickets WHERE expiresAt<=? OR chatId=?").bind(now, chatId),
    db.prepare(`INSERT INTO telegram_admin_tickets(hash,chatId,destination,expiresAt)
      SELECT ?,chatId,?,? FROM telegram_delivery_partners WHERE chatId=? AND role='admin'`)
      .bind(await digest(ticket), destination, now + 120_000, chatId),
  ]);
  return inserted.meta.changes ? `https://musetoken.store/api/admin/telegram-entry#${ticket}` : null;
}

export async function consumeTelegramAdminTicket(db: D1Database, ticket: unknown) {
  if (typeof ticket !== "string" || !ticketPattern.test(ticket)) return null;
  return db.prepare(`DELETE FROM telegram_admin_tickets WHERE hash=? AND expiresAt>?
    AND EXISTS (SELECT 1 FROM telegram_delivery_partners p WHERE p.chatId=telegram_admin_tickets.chatId AND p.role='admin')
    RETURNING chatId,destination`).bind(await digest(ticket), Date.now()).first<{ chatId: string; destination: string }>();
}

export function telegramAdminEntry() {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>卡密大王工作台</title><main><h1>卡密大王工作台</h1><p id="status">正在验证 Telegram 登录链接…</p></main><script nonce="${nonce}">
    const ticket = location.hash.slice(1);
    history.replaceState(null, "", location.pathname);
    fetch("/api/admin/telegram-login", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ticket})})
      .then(async response => {
        if (!response.ok) throw new Error();
        const {destination} = await response.json();
        location.replace("/admin/" + (destination ? "#" + destination : ""));
      })
      .catch(() => { document.getElementById("status").textContent = "登录链接已失效。请回到 Telegram Bot 重新打开工作台。"; });
  </script></html>`, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
  } });
}
