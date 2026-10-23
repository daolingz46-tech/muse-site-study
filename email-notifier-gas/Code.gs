function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const input = JSON.parse(e.postData.contents || "{}");
    const expected = PropertiesService.getScriptProperties().getProperty("BRIDGE_TOKEN") || "";
    const supplied = String(input.token || "");
    if (!expected || !constantTimeEqual_(expected, supplied)) return json_({ ok: false, message: "unauthorized" });
    if (input.purpose === "capability_probe") return json_({ ok: true, buyerDelivery: true });
    if (!/^[A-Za-z0-9:_-]{12,120}$/.test(String(input.id || ""))) return json_({ ok: false, message: "invalid_id" });
    const to = String(input.to || "").trim();
    const purpose = String(input.purpose || "owner_notice");
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to) || to.length > 254) return json_({ ok: false, message: "invalid_recipient" });
    if (purpose === "owner_notice" && to !== "daolingz46@gmail.com") return json_({ ok: false, message: "invalid_recipient" });
    if (purpose !== "owner_notice" && purpose !== "buyer_delivery") return json_({ ok: false, message: "invalid_purpose" });

    lock.waitLock(10000);
    const cache = CacheService.getScriptCache();
    const cacheKey = "sent_" + input.id;
    if (cache.get(cacheKey)) return json_({ ok: true, duplicate: true });
    const subject = String(input.subject || "Muse 商店通知").slice(0, 180);
    const text = String(input.text || "").slice(0, 12000);
    const html = String(input.html || "").slice(0, 20000);
    if (!subject || (!text && !html)) return json_({ ok: false, message: "empty_message" });
    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: text || "请使用支持 HTML 邮件的邮箱查看此通知。",
      htmlBody: html || undefined,
      name: "Muse 商店",
    });
    cache.put(cacheKey, "1", 21600);
    return json_({ ok: true });
  } catch (error) {
    return json_({ ok: false, message: "send_failed" });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function constantTimeEqual_(a, b) {
  let diff = a.length ^ b.length;
  const size = Math.max(a.length, b.length);
  for (let i = 0; i < size; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
