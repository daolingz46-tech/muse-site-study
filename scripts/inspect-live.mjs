import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";

const checks = [
  ["商店首页", "https://musetoken.store/", 200, "text/html"],
  ["工作台页面", "https://musetoken.store/admin/", 200, "text/html"],
  ["订单数据库连接", "https://musetoken.store/api/health", 200, "application/json"],
  ["API 域名", "https://api.musetoken.store/api/health", 200, "application/json"],
  ["微信收款码", "https://musetoken.store/api/payment-qr/wechat", 200, "image/png"],
  ["支付宝收款码", "https://musetoken.store/api/payment-qr/alipay", 200, "image/png"],
  ["工作台权限保护", "https://musetoken.store/api/admin/orders", 401, "application/json"],
  ["附件权限保护", "https://musetoken.store/api/delivery-files/00000000-0000-4000-8000-000000000000", 403, "application/json"],
  ["GitHub 商店入口", "https://daolingz46-tech.github.io/muse-site-study/", 200, "text/html"],
];
const results = await Promise.all(checks.map(async ([name, url, status, type]) => {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "follow", cache: "no-store" });
      assert.equal(response.status, status, `HTTP ${response.status}, expected ${status}`);
      assert.ok(response.headers.get("content-type")?.includes(type), "响应类型异常");
      if (url.endsWith("/api/health")) assert.equal((await response.json()).ok, true);
      else if (type === "image/png") {
        const bytes = new Uint8Array(await response.arrayBuffer());
        assert.deepEqual(Array.from(bytes.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
      } else {
        const text = await response.text();
        if (type === "text/html") assert.match(text, /Muse/);
      }
      return { name, ok: true };
    } catch (cause) { error = cause.message; }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return { name, ok: false, error };
}));
const report = results.map(r => `${r.ok ? "PASS" : "FAIL"}: ${r.name}${r.error ? ` — ${r.error}` : ""}`).join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 线上只读巡检\n\n检查时间：${new Date().toISOString()}\n\n\`\`\`\n${report}\n\`\`\`\n\n邮件实际投递、真实收款和中国大陆运营商连接不在此自动检查范围。\n`);
if (results.some(r => !r.ok)) process.exitCode = 1;
