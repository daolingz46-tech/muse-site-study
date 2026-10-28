import { Parser } from "htmlparser2";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const blockTags = new Set(["p", "div", "h1", "h2", "h3", "h4", "li", "br", "section", "article", "tr"]);
function linkify(value: string): string {
  return value.split(/(https?:\/\/[^\s<>"']+)/g).map(part => {
    if (!/^https?:\/\//.test(part)) return escapeHtml(part);
    const match = part.match(/^(.*?)([),，。；;！!]+)?$/), address = match?.[1] || part, suffix = match?.[2] || "";
    try { const url = new URL(address); if (!["http:", "https:"].includes(url.protocol)) return escapeHtml(part); return `<a href="${escapeHtml(url.href)}" style="color:#315ea8;overflow-wrap:anywhere">${escapeHtml(address)}</a>${escapeHtml(suffix)}`; }
    catch { return escapeHtml(part); }
  }).join("");
}

/** Convert supplier markup to plain text; retain visible wording and HTTP(S) link destinations. */
export function cleanInstructions(input: string): string {
  let output = "", blocked = 0;
  const links: Array<{ href: string; label: string }> = [];
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "script" || name === "style") { blocked++; return; }
      if (blocked) return;
      if (blockTags.has(name) && output && !output.endsWith("\n")) output += "\n";
      if (name === "a") {
        let href = "";
        try { const url = new URL(attributes.href || ""); if (["https:", "http:"].includes(url.protocol)) href = url.href; } catch { /* Ignore unsupported links. */ }
        links.push({ href, label: "" });
      }
    },
    ontext(value) { if (!blocked) { output += value; if (links.length) links[links.length - 1].label += value; } },
    onclosetag(name) {
      if (name === "script" || name === "style") { blocked = Math.max(0, blocked - 1); return; }
      if (blocked) return;
      if (name === "a") { const link = links.pop(); if (link?.href && link.label.trim().replace(/\/$/, "") !== link.href.replace(/\/$/, "")) output += ` (${link.href})`; }
      if (blockTags.has(name) && !output.endsWith("\n")) output += "\n";
    },
  }, { decodeEntities: true });
  parser.write(input); parser.end();
  return output.replace(/\u00a0/g, " ").replace(/\b(?:16688|1688)\b/g, "平台").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function credentialFields(card: string): Array<{ label: string; value: string }> {
  const accountAndLink = card.split("|");
  if (accountAndLink.length === 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountAndLink[0].trim())) {
    try { const url = new URL(accountAndLink[1].trim()); if (["http:", "https:"].includes(url.protocol)) return [{ label: "Muse 登录账号", value: accountAndLink[0].trim() }, { label: "邮箱验证码获取地址", value: accountAndLink[1].trim() }]; } catch { /* Preserve unrecognized content. */ }
  }
  const parts = card.split(/-{4,}/);
  if (parts.length === 3 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parts[0].trim()) && parts[1].trim() && /^[A-Z2-7\s]{16,}$/i.test(parts[2].trim())) {
    return [{ label: "账号", value: parts[0].trim() }, { label: "密码", value: parts[1].trim() }, { label: "2FA 密钥", value: parts[2].trim() }];
  }
  return [{ label: "交付内容", value: card }];
}

export function deliveryEmail(input: { title: string; code: string; card: string; instructions?: string; extraHtml?: string; extraText?: string; support?: string }) {
  const fields = credentialFields(input.card);
  const instructions = cleanInstructions(input.instructions || "");
  const support = input.support || "如有问题，请联系 QQ：3557785836。";
  const rows = fields.map(({ label, value }) => `<div style="margin:10px 0;padding:12px 14px;background:#f5f7fb;border-radius:8px"><div style="font-size:12px;color:#66758e;margin-bottom:4px">${escapeHtml(label)}</div><div style="white-space:pre-wrap;overflow-wrap:anywhere;font-family:monospace;font-size:14px;color:#182238">${linkify(value)}</div></div>`).join("");
  const formattedInstructions = instructions ? `<h3 style="font-size:16px;margin:26px 0 8px">使用说明</h3><div style="white-space:pre-wrap;overflow-wrap:anywhere;color:#39465c">${linkify(instructions)}</div>` : "";
  const html = `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.7;color:#243047;max-width:620px;margin:auto"><div style="font-size:12px;color:#71809a">MUSE 商店 · 订单交付</div><h2 style="font-size:22px;margin:8px 0">${escapeHtml(input.title)}</h2><p style="color:#71809a">订单码：${escapeHtml(input.code)}</p><h3 style="font-size:16px;margin:24px 0 8px">你的商品</h3>${rows}<p style="font-size:12px;color:#71809a">请妥善保管以上信息，勿公开分享。</p>${formattedInstructions}${input.extraHtml || ""}<p style="margin-top:28px;color:#71809a;font-size:13px">${escapeHtml(support)}</p></div>`;
  const text = `${input.title}\n订单码：${input.code}\n\n你的商品\n${fields.map(({ label, value }) => `${label}：${value}`).join("\n\n")}\n\n请妥善保管以上信息，勿公开分享。${instructions ? `\n\n使用说明\n${instructions}` : ""}${input.extraText ? `\n\n${input.extraText}` : ""}\n\n${support}`;
  return { html, text };
}
