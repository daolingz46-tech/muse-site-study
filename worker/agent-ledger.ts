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
