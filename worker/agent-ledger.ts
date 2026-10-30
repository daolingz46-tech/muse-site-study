/** Beijing-calendar next day at midnight; financial events must be explicitly verified. */
export function nextBeijingDay(timestamp: number): number {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("invalid_timestamp");
  const offset = 8 * 60 * 60 * 1000;
  const day = 24 * 60 * 60 * 1000;
  return (Math.floor((timestamp + offset) / day) + 1) * day - offset;
}
export function commissionAvailableAt(paidAt: number | null, completedAt: number | null): number | null {
  if (paidAt === null || completedAt === null) return null;
  return nextBeijingDay(Math.max(paidAt, completedAt));
}
export function payoutDueAt(approvedAt: number): number { return nextBeijingDay(approvedAt); }
/** Select the most recent valid referral before checkout; ties resolve by arrival order. */
export function lastValidReferral<T extends { code: string; visitedAt: number }>(visits: T[], checkoutAt: number, validityMs: number, activeCodes: ReadonlySet<string>): T | null {
  if (!Number.isSafeInteger(checkoutAt) || checkoutAt < 0 || !Number.isSafeInteger(validityMs) || validityMs <= 0) throw new Error("invalid_referral_window");
  let selected: T | null = null;
  for (const visit of visits) {
    if (!activeCodes.has(visit.code) || !Number.isSafeInteger(visit.visitedAt) || visit.visitedAt > checkoutAt || checkoutAt - visit.visitedAt >= validityMs) continue;
    if (!selected || visit.visitedAt >= selected.visitedAt) selected = visit;
  }
  return selected;
}
