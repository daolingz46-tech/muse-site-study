import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { supplierRequest } from "../worker/supplier16688.ts";

test("signs supplier requests without exposing the secret", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://www.16688.com.cn/openApi/purchase/quotePrice");
    const body = JSON.parse(init.body);
    assert.equal(body.secret, undefined);
    const { sign, ...params } = body;
    const canonical = Object.keys(params).sort().map(key => `${key}=${String(params[key])}`).join("&");
    assert.equal(sign, createHmac("sha256", "test-secret").update(`POST\npurchase\nquoteprice\n${canonical}`).digest("hex"));
    return Response.json({ code: 1, data: {} });
  };
  try {
    const response = await supplierRequest({ appId: "test-app", secret: "test-secret" }, "purchase", "quotePrice", { goods_no: "G19335525", quantity: 1 });
    assert.equal(response.code, 1);
  } finally { globalThis.fetch = original; }
});
