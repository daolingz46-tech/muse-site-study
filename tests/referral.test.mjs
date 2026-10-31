import { test } from "node:test";
import assert from "node:assert/strict";
import { rememberReferral, storedReferralCode } from "../src/components/sites/muse/referral.ts";

function storage() {
  const entries = new Map();
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
  };
}

test("the last confirmed referral remains selected after a year", t => {
  const saved = storage();
  const agentA = "a".repeat(32), agentC = "c".repeat(32);
  let now = Date.parse("2026-01-01T00:00:00Z");
  t.mock.method(Date, "now", () => now);
  rememberReferral(saved, agentA, Date.now());
  now += 60_000;
  rememberReferral(saved, agentC, Date.now());
  now += 366 * 86400000;
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

test("old draft storage remains usable after its former expiry", () => {
  const saved = storage(), agentC = "c".repeat(32);
  saved.setItem("store-referral", JSON.stringify({ code: agentC, expires: 1 }));
  assert.equal(storedReferralCode(saved), agentC);
  rememberReferral(saved, "a".repeat(32), 2);
  assert.equal(storedReferralCode(saved), "a".repeat(32));
});
