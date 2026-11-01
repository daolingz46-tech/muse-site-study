import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

export type CommissionControlAction = "hold" | "release" | "refund";
export type CommissionControlInput = {
  orderId: string;
  operationId: string;
  action: CommissionControlAction;
  reason: string;
  now: number;
};
export type CommissionControlOutcome =
  | { ok: true; state: "hold" | "active" | "refunded"; replay: boolean }
  | { ok: false; reason: "not_found_or_invalid_transition" | "operation_conflict" };

/**
 * Caller must authenticate the owner and enforce same-origin/rate limits.
 * All returned statements MUST execute in one D1 batch transaction, in order.
 * Reconciliation must exclude commission_controls states hold/refunded.
 * Withdrawal reservation/approval/payout must independently enforce holds and signed balance.
 */
export function commissionControlStatements(db: D1Database, input: CommissionControlInput): { statements: D1PreparedStatement[]; executionId: string } {
  if (!/^M[a-f0-9]{32}$/.test(input.orderId) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.operationId)
    || !["hold", "release", "refund"].includes(input.action) || input.reason.trim().length < 4 || input.reason.trim().length > 500
    || !Number.isSafeInteger(input.now) || input.now < 0) throw new Error("invalid_commission_control");
  const orderId = input.orderId, operationId = input.operationId.toLowerCase(), reason = input.reason.trim();
  const executionId = crypto.randomUUID();
  const target = input.action === "hold" ? "hold" : input.action === "release" ? "active" : "refunded";
  return { executionId, statements: [
    db.prepare("INSERT OR IGNORE INTO commission_controls(orderId,state,revision,updatedAt) SELECT orderId,'active',0,? FROM agent_order_attribution WHERE orderId=?").bind(input.now,orderId),
    db.prepare(`INSERT OR IGNORE INTO commission_control_audit(operationId,executionId,orderId,action,stateBefore,stateAfter,reason,actor,createdAt)
      SELECT ?,?,orderId,?,state,?,?,'owner',? FROM commission_controls
      WHERE orderId=? AND ((?='hold' AND state='active') OR (?='release' AND state='hold') OR (?='refund' AND state IN ('active','hold')))
      AND NOT EXISTS(SELECT 1 FROM agent_order_attribution a JOIN agent_withdrawals w ON w.agentId=a.agentId WHERE a.orderId=commission_controls.orderId AND w.status IN ('paying','unknown'))`)
      .bind(operationId,executionId,input.action,target,reason,input.now,orderId,input.action,input.action,input.action),
    db.prepare(`INSERT INTO agent_ledger(id,agentId,orderId,eventKey,amountCents,kind,availableAt,createdAt)
      SELECT 'commission-control:'||a.operationId,l.agentId,l.orderId,'commission-control:'||a.operationId,
        CASE WHEN a.action='release' THEN l.amountCents ELSE -l.amountCents END,'adjustment',l.availableAt,?
      FROM commission_control_audit a JOIN agent_ledger l ON l.eventKey='commission:'||a.orderId AND l.kind='commission'
      WHERE a.executionId=? AND a.applied=0 AND (a.action IN ('hold','release') OR (a.action='refund' AND a.stateBefore='active'))`)
      .bind(input.now,executionId),
    db.prepare(`UPDATE commission_controls SET state=(SELECT stateAfter FROM commission_control_audit WHERE executionId=?), revision=revision+1,updatedAt=?
      WHERE orderId=? AND EXISTS(SELECT 1 FROM commission_control_audit WHERE executionId=? AND applied=0)`)
      .bind(executionId,input.now,orderId,executionId),
    db.prepare("UPDATE commission_control_audit SET applied=1 WHERE executionId=? AND applied=0").bind(executionId),
  ] };
}

/** Resolves idempotent retries and rejects reusing the same ID for another request. */
export async function commissionControlOutcome(db: D1Database, input: CommissionControlInput, executionId: string): Promise<CommissionControlOutcome> {
  const audit = await db.prepare("SELECT executionId,orderId,action,reason,stateAfter,applied FROM commission_control_audit WHERE operationId=?")
    .bind(input.operationId.toLowerCase()).first<{executionId:string;orderId:string;action:string;reason:string;stateAfter:"hold"|"active"|"refunded";applied:number}>();
  if (!audit) return { ok: false, reason: "not_found_or_invalid_transition" };
  if (audit.orderId !== input.orderId || audit.action !== input.action || audit.reason !== input.reason.trim() || audit.applied !== 1) return { ok: false, reason: "operation_conflict" };
  return { ok: true, state: audit.stateAfter, replay: audit.executionId !== executionId };
}

export async function applyCommissionControl(db: D1Database, input: CommissionControlInput): Promise<CommissionControlOutcome> {
  const operation = commissionControlStatements(db, input);
  await db.batch(operation.statements);
  return commissionControlOutcome(db, input, operation.executionId);
}
