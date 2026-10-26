import { chromium, expect } from "@playwright/test";

// Read-only on production: never submit orders or send mail.
const base = process.env.TEST_BASE_URL || "https://musetoken.store";
const browser = await chromium.launch(process.env.CI ? {} : { channel: "chrome" });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Click immediately, including before hydration has finished.
    await page.getByRole("tab", { name: "Muse Token", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Muse Token", exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('input[name="token-plan"]')).toHaveCount(4);
    await page.getByLabel("账号邀请码").fill("NAVIGATION-CHECK");
    await page.locator('input[name="token-plan"][value="100"]').check();
    await expect(page.locator('input[name="token-plan"][value="100"]')).toBeChecked();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Muse Token", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Muse AI", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Muse AI", exact: true })).toBeVisible({ timeout: 30000 });
    expect(errors).toEqual([]);
    await context.close();
    console.log(`PASS: ${width}px Token 切换、四档套餐、邀请码输入、刷新与返回`);
  }
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("tab", { name: "Muse Token", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Muse Token", exact: true })).toBeVisible();
  await expect(page.locator('input[name="token-plan"]')).toHaveCount(4);
  console.log("PASS: JavaScript 未执行时仍可打开 Token 独立页面");
  await context.close();
} finally { await browser.close(); }
