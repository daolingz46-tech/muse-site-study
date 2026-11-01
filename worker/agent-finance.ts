import type { D1Database } from "@cloudflare/workers-types";

/** Record each eligible completed order exactly once. Times use Beijing calendar days. */
export function commissionReconciliation(db: D1Database, agentId: string, now: number) {
  return db.prepare(`INSERT OR IGNORE INTO agent_ledger(id,agentId,orderId,eventKey,amountCents,kind,availableAt,createdAt)
    SELECT 'commission:'||a.orderId,a.agentId,a.orderId,'commission:'||a.orderId,a.commissionCents,'commission',
      ((MAX(o.paidAt,o.completedAt)+28800000)/86400000+1)*86400000-28800000,?
    FROM agent_order_attribution a JOIN orders o ON o.id=a.orderId
    WHERE a.agentId=? AND o.status='complete' AND o.paidAt IS NOT NULL AND o.completedAt IS NOT NULL
      AND a.ruleVersion>0 AND a.commissionCents<=o.amountCents
      AND NOT EXISTS(SELECT 1 FROM commission_controls c WHERE c.orderId=a.orderId AND c.state IN ('hold','refunded'))`).bind(now,agentId);
}

export async function agentBalance(db: D1Database, agentId: string, now: number) {
  await commissionReconciliation(db,agentId,now).run();
  const balance = await db.prepare(`SELECT
    COALESCE((SELECT SUM(amountCents) FROM agent_ledger WHERE agentId=? AND availableAt<=? AND kind IN ('commission','adjustment')),0) AS matured,
    COALESCE((SELECT SUM(amountCents) FROM agent_ledger WHERE agentId=? AND availableAt>? AND kind IN ('commission','adjustment')),0) AS pendingCents,
    COALESCE((SELECT SUM(amountCents) FROM agent_withdrawals WHERE agentId=? AND status IN ('pending','approved','paying','unknown')),0) AS reservedCents,
    COALESCE((SELECT SUM(amountCents) FROM agent_withdrawals WHERE agentId=? AND status='paid'),0) AS paidCents,
    EXISTS(SELECT 1 FROM agent_order_attribution a JOIN commission_controls c ON c.orderId=a.orderId WHERE a.agentId=? AND c.state='hold') AS hasHold`)
    .bind(agentId,now,agentId,now,agentId,agentId,agentId).first<{matured:number;pendingCents:number;reservedCents:number;paidCents:number;hasHold:number}>();
  if (!balance) throw new Error("balance_unavailable");
  const book=balance.matured-balance.paidCents;
  return {availableCents:balance.hasHold ? 0 : Math.max(0,book-balance.reservedCents),pendingCents:balance.pendingCents,reservedCents:balance.reservedCents,paidCents:balance.paidCents,debtCents:Math.max(0,-book),reserveShortfallCents:Math.max(0,balance.reservedCents-Math.max(0,book)),hasHold:!!balance.hasHold};
}

/** A single INSERT reserves funds atomically, including concurrent requests. */
export function withdrawalReservation(db: D1Database, agentId: string, id: string, cents: number, now: number) {
  return db.prepare(`INSERT OR IGNORE INTO agent_withdrawals(id,agentId,amountCents,status,requestedAt,updatedAt)
    SELECT ?,?,?,'pending',?,? WHERE ? <=
      COALESCE((SELECT SUM(amountCents) FROM agent_ledger WHERE agentId=? AND availableAt<=? AND kind IN ('commission','adjustment')),0)
      - COALESCE((SELECT SUM(amountCents) FROM agent_withdrawals WHERE agentId=? AND status IN ('pending','approved','paying','unknown','paid')),0)
      AND NOT EXISTS(SELECT 1 FROM agent_order_attribution a JOIN commission_controls c ON c.orderId=a.orderId WHERE a.agentId=? AND c.state='hold')`)
    .bind(id,agentId,cents,now,now,cents,agentId,now,agentId,agentId);
}
