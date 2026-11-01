import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanInstructions, deliveryEmail } from "../worker/delivery-email.ts";

test("formats account credentials and supplier instructions without exposing HTML tags", () => {
  const instructions = '<h3>发货格式：账号----密码----2FA</h3><p>验证码：<a href="https://example.com/verify">点击获取</a>&nbsp;备用说明</p><p>16688 平台说明</p><script>unsafe()</script>';
  const result = deliveryEmail({ title: "测试账号", code: "1234", card: "buyer@example.com----pass&123----ABCD2345EFGH2345", instructions });
  assert.match(result.html, /账号/); assert.match(result.html, /密码/); assert.match(result.html, /2FA 密钥/);
  assert.match(result.html, /pass&amp;123/); assert.match(result.text, /pass&123/);
  assert.match(result.text, /点击获取 \(https:\/\/example.com\/verify\)/);
  assert.match(result.html, /href="https:\/\/example.com\/verify"/);
  assert.doesNotMatch(result.text, /<h3|&nbsp;|16688|unsafe\(\)/);
  assert.doesNotMatch(result.html, /&lt;h3|16688|unsafe\(\)/);
});

test("keeps unrecognized delivery text intact and decodes instructions", () => {
  const card = "ABC----DEF----not-a-2fa\nhttps://example.com/redeem";
  const result = deliveryEmail({ title: "充值", code: "0099", card, instructions: "<p>步骤一<br>步骤二 &amp; 注意事项</p>" });
  assert.ok(result.text.includes(card)); assert.ok(result.text.includes("步骤一\n步骤二 & 注意事项"));
  assert.equal(cleanInstructions("普通说明"), "普通说明");
});

test("formats Muse account and verification link without adding a password", () => {
  const result = deliveryEmail({ title: "Muse", code: "1111", card: "buyer@example.com|https://example.com/code?token=abc" });
  assert.match(result.text, /Muse 登录账号：buyer@example.com/);
  assert.match(result.text, /邮箱验证码获取地址：https:\/\/example.com\/code\?token=abc/);
  assert.match(result.html, /href="https:\/\/example.com\/code\?token=abc"/);
  assert.doesNotMatch(result.text, /密码/);
});


test("formats Muse email password and verification link from the new supplier", () => {
  const result = deliveryEmail({ title: "Muse AI · 成品账号", code: "1111", card: "buyer@example.com—mail-pass--https://example.com/code?token=abc" });
  assert.match(result.text, /Muse 登录账号：buyer@example.com/);
  assert.match(result.text, /邮箱密码：mail-pass/);
  assert.match(result.text, /邮箱验证码获取地址：https:\/\/example.com\/code\?token=abc/);
});
