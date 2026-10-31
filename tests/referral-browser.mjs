import { chromium, expect } from "@playwright/test";

// All requests are intercepted and orders are simulated; never run against a live store.
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:18935";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw new Error("Only a local test server is allowed");
const agentA = "a".repeat(32), agentC = "c".repeat(32), invalidAgent = "d".repeat(32);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  let submitted;
  let referralServiceDown = false;
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (url.pathname === "/api/referral") return referralServiceDown
      ? route.fulfill({ status: 503, headers, json: {} })
      : route.fulfill({ headers, json: { valid: url.searchParams.get("code") !== invalidAgent } });
    if (url.pathname === "/api/availability") return route.fulfill({ headers, json: { stock: {} } });
    if (url.pathname === "/api/visit") return route.fulfill({ headers, json: { ok: true } });
    if (url.pathname === "/api/orders") {
      submitted = route.request().postDataJSON();
      return route.fulfill({ headers, json: { id: "test-order", token: "test-token", code: "1234", title: "Muse AI", amountCents: 1200, feeCents: 0, expiresAt: Date.now() + 900000, status: "pending", method: submitted.method, product: "muse", email: submitted.email } });
    }
    return route.fulfill({ status: 404, headers, json: {} });
  });
  await page.goto(`${base}/?ref=${agentA}`);
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("store-referral") || "null")?.code)).toBe(agentA);
  await page.goto(`${base}/?ref=${agentC}`);
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("store-referral") || "null")?.code)).toBe(agentC);
  const invalidResponse = page.waitForResponse(response => response.url().includes("/api/referral"));
  await page.goto(`${base}/?ref=${invalidAgent}`);
  await invalidResponse;
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("store-referral") || "null")?.code)).toBe(agentC);
  await page.getByRole("tab", { name: "Muse Token", exact: true }).click();
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("store-referral") || "null")?.code)).toBe(agentC);
  await page.addInitScript(() => { const now = Date.now.bind(Date); Date.now = () => now() + 366 * 86400000; });
  await page.goto(`${base}/`);
  await page.getByLabel("收件邮箱").fill("buyer@example.com");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认订单" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "继续下单", exact: true }).click({ timeout: 10000 });
  await expect.poll(() => submitted !== undefined).toBe(true);
  expect(submitted.referralCode).toBeUndefined();
  console.log("PASS: direct visit after a year creates an order without agent attribution");

  submitted = undefined;
  await page.goto(`${base}/?ref=${agentC}`);
  await page.getByLabel("收件邮箱").fill("buyer@example.com");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认订单" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "继续下单", exact: true }).click({ timeout: 10000 });
  await expect.poll(() => submitted?.referralCode).toBe(agentC);
  console.log("PASS: opening C's link after a year attributes the order to C");

  submitted = undefined;
  referralServiceDown = true;
  await page.goto(`${base}/?ref=${agentA}`);
  await page.getByLabel("收件邮箱").fill("buyer@example.com");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认订单" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "继续下单", exact: true }).click({ timeout: 10000 });
  await expect(page.locator(".muse-error[role=alert]")).toHaveText("推广链接暂时无法验证，请检查网络后重试。");
  expect(submitted).toBeUndefined();
  console.log("PASS: temporary validation failure does not silently assign another agent");
} finally { await browser.close(); }
