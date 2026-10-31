import { test } from "node:test";
import assert from "node:assert/strict";
import { nextBeijingDay, commissionAvailableAt, payoutDueAt } from "../worker/agent-ledger.ts";
test("T+1 uses the next Beijing calendar day, including near midnight and year boundaries", () => {
  assert.equal(new Date(nextBeijingDay(Date.parse("2026-12-31T15:59:59Z"))).toISOString(), "2026-12-31T16:00:00.000Z");
  assert.equal(new Date(payoutDueAt(Date.parse("2026-12-31T16:00:00Z"))).toISOString(), "2027-01-01T16:00:00.000Z");
});
test("commission only settles after both payment and fulfillment", () => {
  assert.equal(commissionAvailableAt(null, 123), null);
  assert.equal(commissionAvailableAt(123, null), null);
  assert.equal(commissionAvailableAt(100, 86400000), nextBeijingDay(86400000));
  assert.throws(() => nextBeijingDay(NaN));
});
