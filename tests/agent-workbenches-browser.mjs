import { chromium, expect } from "@playwright/test";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:18935";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw new Error("Only a local test server is allowed");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const referralCode = "a".repeat(32);
let agentLoggedIn = false;
let ordersAgentId = "test";
const agents = [];
const rules = [];
const products = [{ productKey: "museAccount", name: "Muse 成品账号", priceCents: 1200, category: "Muse" }];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const respond = (data, status = 200) => route.fulfill({ status, json: data });
    if (url.pathname === "/api/agent/login") { agentLoggedIn = true; return respond({ ok: true }); }
    if (url.pathname === "/api/agent/logout") { agentLoggedIn = false; return respond({ ok: true }); }
    if (url.pathname === "/api/agent/me") return agentLoggedIn ? respond({ id: "test", name: "测试代理", referralCode }) : respond({ message: "请登录" }, 401);
    if (url.pathname === "/api/agent/orders") return agentLoggedIn ? respond({ agentId: ordersAgentId, orders: [{ code: "1234", title: "Muse 成品账号", status: "complete", createdAt: Date.now(), commissionCents: 0, ruleVersion: 0 }] }) : respond({ message: "请登录" }, 401);
    if (url.pathname === "/api/admin/orders") return respond({ orders: [], count: { total: 0 }, page: 0, summary: { total: 0, awaiting: 0, processing: 0, completed: 0, revenueCents: 0, todayCents: 0 } });
    if (url.pathname === "/api/admin/agents") return respond({ agents, rules, products });
    if (url.pathname === "/api/admin/agent-create") { agents.push({ id: "test", name: "测试代理", referralCode, status: "active", orderCount: 0, completedOrderCount: 0 }); return respond({ name: "测试代理", referralCode }); }
    if (url.pathname === "/api/admin/agent-rule") { const input = route.request().postDataJSON(); rules.splice(0, rules.length, { ...input, updatedAt: Date.now() }); return respond({ ok: true }); }
    if (url.pathname === "/api/admin/agent-status") { agents[0].status = route.request().postDataJSON().status; return respond({ ok: true }); }
    if (url.pathname === "/api/admin/visits") return respond({ summary: { total: 0, today: 0, last7Days: 0 }, recent: [] });
    if (url.pathname === "/api/admin/catalog") return respond({ products: [] });
    if (url.pathname === "/api/admin/tutorial") return respond({ title: "教程", blocks: [], updatedAt: null });
    return respond({});
  });
  const admin = await context.newPage();
  await admin.goto(`${base}/admin/`);
  const section = admin.locator("#agent-management");
  await expect(section.getByRole("heading", { name: "代理管理" })).toBeVisible();
  await section.getByRole("button", { name: "创建代理" }).click();
  await section.getByLabel("代理名称").fill("测试代理");
  await section.getByLabel("设置登录密码").fill("Test-password-2026");
  await section.getByRole("button", { name: "确认创建" }).click();
  await expect(section.getByText("测试代理", { exact: true })).toBeVisible();
  const rule = section.locator("form.wb-agent-rule").first();
  await rule.getByLabel("每单佣金（元）").fill("3.00");
  await rule.getByRole("button", { name: "保存" }).click();
  await expect(section.getByText("当前佣金 ¥3.00", { exact: false })).toBeVisible();
  expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const agent = await context.newPage();
  await agent.goto(`${base}/agent/`);
  await agent.getByLabel("代理编号").fill(referralCode);
  await agent.getByLabel("登录密码").fill("Test-password-2026");
  await agent.getByRole("button", { name: "登录", exact: true }).click();
  await expect(agent.getByText("你好，测试代理")).toBeVisible();
  await expect(agent.getByText("未配置佣金")).toBeVisible();
  await expect(agent.getByLabel("你的推广链接")).toHaveValue(`https://musetoken.store/?ref=${referralCode}`);
  expect(await agent.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  ordersAgentId = "different-agent";
  await agent.getByRole("button", { name: "刷新" }).click();
  await expect(agent.getByText("代理账号状态已变化，请重新登录")).toBeVisible();
  await expect(agent.getByText("1234", { exact: false })).toHaveCount(0);
  ordersAgentId = "test";
  await agent.getByLabel("登录密码").fill("Test-password-2026");
  await agent.getByRole("button", { name: "登录", exact: true }).click();
  await expect(agent.getByText("你好，测试代理")).toBeVisible();
  await agent.getByRole("button", { name: "退出登录" }).click();
  await expect(agent.getByLabel("登录密码")).toBeVisible();
  console.log("PASS: mobile admin agent setup and commission settings; agent login, orders, and logout");
} finally { await browser.close(); }
