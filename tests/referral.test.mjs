import { test } from "node:test";
import assert from "node:assert/strict";
import { isDirectVisit, rememberReferral, storedReferralCode } from "../src/components/sites/muse/referral.ts";

function storage() {
  const entries = new Map();
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
  };
}

test("the last confirmed referral remains selected during the visit", t => {
  const saved = storage();
  const agentA = "a".repeat(32), agentC = "c".repeat(32);
  let now = Date.parse("2026-01-01T00:00:00Z");
  t.mock.method(Date, "now", () => now);
  rememberReferral(saved, agentA, Date.now());
  now += 60_000;
  rememberReferral(saved, agentC, Date.now());
  assert.equal(storedReferralCode(saved), agentC);
});

test("a delayed earlier visit cannot replace a later confirmed visit", () => {
  const saved = storage();
  const agentA = "a".repeat(32), agentC = "c".repeat(32);
  rememberReferral(saved, agentC, 2000);
  rememberReferral(saved, agentA, 1000);
  rememberReferral(saved, "invalid", 3000);
  assert.equal(storedReferralCode(saved), agentC);
});

test("a fresh direct or external visit clears attribution; navigation and reload preserve it", () => {
  const origin = "https://musetoken.store";
  assert.equal(isDirectVisit("navigate", "", origin), true);
  assert.equal(isDirectVisit("navigate", "https://example.com/", origin), true);
  assert.equal(isDirectVisit("navigate", `${origin}/token/`, origin), false);
  assert.equal(isDirectVisit("reload", "", origin), false);
  assert.equal(isDirectVisit("back_forward", "", origin), false);
});
