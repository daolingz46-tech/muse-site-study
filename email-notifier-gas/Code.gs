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
    if (input.purpose === "capability_probe") return json_({ ok: true, buyerDelivery: true, attachments: true });
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
    const files = Array.isArray(input.attachments) ? input.attachments : [];
    if (files.length > 4 || (purpose !== "buyer_delivery" && files.length)) return json_({ ok: false, message: "invalid_attachments" });
    const attachments = [];
    let totalBytes = 0;
    for (const file of files) {
      const url = String(file.url || "");
      const name = String(file.name || "").replace(/[\\/\x00-\x1f]/g, "_").slice(0, 120);
      if (!name || !/^https:\/\/musetoken\.store\/api\/delivery-files\/[a-f0-9-]{36}\?signature=[a-f0-9]{64}$/.test(url)) return json_({ ok: false, message: "invalid_attachment_url" });
      const response = UrlFetchApp.fetch(url, { followRedirects: false, muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) return json_({ ok: false, message: "attachment_download_failed" });
      const blob = response.getBlob().setName(name);
      totalBytes += blob.getBytes().length;
      if (totalBytes > 20000000) return json_({ ok: false, message: "attachments_too_large" });
      attachments.push(blob);
    }
    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: text || "请使用支持 HTML 邮件的邮箱查看此通知。",
      htmlBody: html || undefined,
      name: "Muse 商店",
      attachments: attachments,
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
