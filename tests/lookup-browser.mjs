import { chromium, expect } from "@playwright/test";
const base = "http://127.0.0.1:8787";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const owner = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await owner.newPage();
  await page.goto(base);
  const order = await page.evaluate(async () => {
    const r = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product: "muse-token", planId: "100", inviteCode: "LOOKUP-CHECK-INVITE", method: "wechat", acceptedTerms: true, requestId: crypto.randomUUID() }) });
    if (!r.ok) throw Error("Create failed"); return r.json();
  });
  await page.goto(`${base}/#order=${order.id}&token=${order.token}`);
  await expect(page.getByRole("heading", { name: "支付订单" })).toBeVisible();
  await page.goto(base);
  await page.getByRole("button", { name: "我的订单" }).click();
  await expect(page.getByText("已保存的订单 · 无需复制")).toBeVisible();
  await expect(page.locator('#muse-order-token')).toHaveCount(0);
  await page.getByLabel("4 位订单码 / 订单编号").fill(order.code);
  await page.getByRole("button", { name: "查询订单", exact: true }).click();
  await expect(page.getByRole("heading", { name: "支付订单" })).toBeVisible();
  const stranger = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const remote = await stranger.newPage(); await remote.goto(base);
  await remote.getByRole("button", { name: "我的订单" }).click();
  await remote.getByLabel("4 位订单码 / 订单编号").fill(order.code);
  await remote.getByRole("button", { name: "查询订单", exact: true }).click();
  await expect(remote.getByRole("status")).toContainText(`订单码 ${order.code}`);
  await expect(remote.getByRole("status")).not.toContainText(order.id);
  await expect(remote.getByRole("status")).not.toContainText("LOOKUP-CHECK-INVITE");
  await remote.getByLabel("4 位订单码 / 订单编号").fill(order.id);
  await remote.getByRole("button", { name: "查询订单", exact: true }).click();
  await expect(remote.getByRole("heading", { name: "支付订单" })).toBeVisible();
  await expect(remote.getByText("LOOKUP-CHECK-INVITE", { exact: true })).toBeVisible();
  console.log("PASS: 单字段查询、刷新后保存入口、同机四位码恢复、跨设备四位码脱敏查询、单独订单编号恢复");
} finally { await browser.close(); }
