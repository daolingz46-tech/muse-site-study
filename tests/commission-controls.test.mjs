import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { agentBalance, commissionReconciliation, withdrawalReservation } from "../worker/agent-finance.ts";
import { applyCommissionControl } from "../worker/commission-controls.ts";

// This adapter serializes batches on one SQLite connection. It checks the SQL
// transaction behavior locally, not D1's distributed execution environment.
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT,paidAt INTEGER,completedAt INTEGER,amountCents INTEGER NOT NULL);");
  sqlite.exec(readFileSync(new URL("../migrations/0013_agent_foundation.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0020_commission_controls.sql", import.meta.url), "utf8"));
  sqlite.prepare("INSERT INTO agents VALUES(?,? ,?,'active',?)").run("agent", "测试代理", "a".repeat(32), 1);
  class Statement {
    constructor(query) { this.query = query; this.values = []; }
    bind(...values) { this.values = values; return this; }
    runSync() { const result = sqlite.prepare(this.query).run(...this.values); return { meta: { changes: Number(result.changes) } }; }
    async run() { return this.runSync(); }
    async first() { return sqlite.prepare(this.query).get(...this.values) ?? null; }
  }
  const db = {
    prepare(query) { return new Statement(query); },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const results = statements.map(statement => statement.runSync()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const now = Date.parse("2026-01-05T00:00:00Z");
  function order(suffix, cents = 500) {
    const id = `M${suffix.repeat(32)}`;
    sqlite.prepare("INSERT INTO orders VALUES(?,'complete',?,?,?)").run(id, now - 4 * 86400000, now - 4 * 86400000, 2000);
    sqlite.prepare("INSERT INTO agent_order_attribution VALUES(?,?,'museAccount',?,?,?)").run(id, "agent", cents, 1, now - 4 * 86400000);
    return id;
  }
  function action(orderId, action, operationId = randomUUID()) { return { orderId, action, operationId, reason: "订单核查测试", now }; }
  function reserve(id, cents) { return db.batch([commissionReconciliation(db, "agent", now), withdrawalReservation(db, "agent", id, cents, now)]); }
  return { db, sqlite, now, order, action, reserve };
}

test("refund before reconciliation prevents a commission from being created later", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const id = f.order("a");
  assert.equal((await applyCommissionControl(f.db, f.action(id, "refund"))).ok, true);
  assert.equal((await agentBalance(f.db, "agent", f.now)).availableCents, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM agent_ledger WHERE orderId=?").get(id).n, 0);
  assert.equal((await applyCommissionControl(f.db, f.action(id, "release"))).ok, false);
});

test("hold and refund preserve existing reservations, report shortfall, and prevent further reservation", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const id = f.order("b");
  assert.equal((await f.reserve("withdrawal-a", 400))[1].meta.changes, 1);
  assert.equal((await applyCommissionControl(f.db, f.action(id, "hold"))).ok, true);
  let balance = await agentBalance(f.db, "agent", f.now);
  assert.deepEqual({ available: balance.availableCents, shortfall: balance.reserveShortfallCents, debt: balance.debtCents, hold: balance.hasHold }, { available: 0, shortfall: 400, debt: 0, hold: true });
  assert.equal((await f.reserve("withdrawal-b", 1))[1].meta.changes, 0);
  assert.equal((await applyCommissionControl(f.db, f.action(id, "release"))).ok, true);
  balance = await agentBalance(f.db, "agent", f.now);
  assert.equal(balance.availableCents, 100);
  assert.equal((await applyCommissionControl(f.db, f.action(id, "refund"))).ok, true);
  balance = await agentBalance(f.db, "agent", f.now);
  assert.equal(balance.reserveShortfallCents, 400);
  assert.equal(balance.debtCents, 0);
  assert.equal((await f.reserve("withdrawal-c", 1))[1].meta.changes, 0);
});

test("refund after payout creates real debt that future commissions must offset", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const id = f.order("c");
  assert.equal((await f.reserve("paid-withdrawal", 400))[1].meta.changes, 1);
  f.sqlite.prepare("UPDATE agent_withdrawals SET status='paid' WHERE id=?").run("paid-withdrawal");
  assert.equal((await applyCommissionControl(f.db, f.action(id, "refund"))).ok, true);
  let balance = await agentBalance(f.db, "agent", f.now);
  assert.equal(balance.debtCents, 400); assert.equal(balance.availableCents, 0);
  f.order("d", 300);
  balance = await agentBalance(f.db, "agent", f.now);
  assert.equal(balance.debtCents, 100); assert.equal(balance.availableCents, 0);
  f.order("e", 200);
  balance = await agentBalance(f.db, "agent", f.now);
  assert.equal(balance.debtCents, 0); assert.equal(balance.availableCents, 100);
});

test("repeated concurrent control requests create exactly one accounting adjustment", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const id = f.order("f");
  await agentBalance(f.db, "agent", f.now);
  const request = f.action(id, "refund");
  const results = await Promise.all(Array.from({ length: 8 }, () => applyCommissionControl(f.db, request)));
  assert.ok(results.every(result => result.ok));
  assert.equal(results.filter(result => !result.replay).length, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM agent_ledger WHERE orderId=? AND kind='adjustment'").get(id).n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM commission_control_audit WHERE orderId=?").get(id).n, 1);
  const conflict = await applyCommissionControl(f.db, { ...request, reason: "不同的核查原因" });
  assert.equal(conflict.reason, "operation_conflict");
});

test("both serialized orderings of hold versus reservation leave no unbacked available funds", async t => {
  for (const holdFirst of [true, false]) {
    const f = fixture();
    try {
      const id = f.order("9");
      const hold = () => applyCommissionControl(f.db, f.action(id, "hold"));
      const reserve = () => f.reserve("contended-withdrawal", 500);
      const results = holdFirst ? await Promise.all([hold(), reserve()]) : await Promise.all([reserve(), hold()]);
      const reservation = holdFirst ? results[1] : results[0];
      assert.equal(reservation[1].meta.changes, holdFirst ? 0 : 1);
      const balance = await agentBalance(f.db, "agent", f.now);
      assert.equal(balance.availableCents, 0);
      assert.equal(balance.reserveShortfallCents, holdFirst ? 0 : 500);
      assert.equal(balance.debtCents, 0);
    } finally { f.sqlite.close(); }
  }
});

test("commission control waits for an in-flight manual transfer to be resolved", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const id = f.order("7");
  await f.reserve("paying-withdrawal", 200);
  f.sqlite.prepare("UPDATE agent_withdrawals SET status='paying' WHERE id=?").run("paying-withdrawal");
  assert.equal((await applyCommissionControl(f.db, f.action(id, "refund"))).ok, false);
  f.sqlite.prepare("UPDATE agent_withdrawals SET status='unknown' WHERE id=?").run("paying-withdrawal");
  assert.equal((await applyCommissionControl(f.db, f.action(id, "hold"))).ok, false);
  f.sqlite.prepare("UPDATE agent_withdrawals SET status='paid' WHERE id=?").run("paying-withdrawal");
  assert.equal((await applyCommissionControl(f.db, f.action(id, "refund"))).ok, true);
  assert.equal((await agentBalance(f.db, "agent", f.now)).debtCents,200);
});
