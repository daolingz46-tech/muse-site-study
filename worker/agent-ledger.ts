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
/** Derive a password hash using PBKDF2; salt is randomly generated per account. */
export async function deriveAgentPassword(password: string, saltHex: string, iterations = 210000): Promise<string> {
  if (password.length < 12 || password.length > 256 || !/^[0-9a-f]{32}$/.test(saltHex) || !Number.isSafeInteger(iterations) || iterations < 210000 || iterations > 1000000) throw new Error("invalid_agent_credentials");
  const salt = new Uint8Array(saltHex.match(/../g)!.map(v => parseInt(v,16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return Array.from(new Uint8Array(bits), x => x.toString(16).padStart(2, "0")).join("");
}
