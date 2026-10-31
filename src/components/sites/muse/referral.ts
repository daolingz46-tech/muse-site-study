const referralStorageKey = "store-referral";
const referralCodePattern = /^[a-f0-9]{32}$/;

type ReferralRecord = { code: string; visitedAt: number };
type ReferralStorage = Pick<Storage, "getItem" | "setItem">;

function readReferral(storage: Pick<Storage, "getItem">): ReferralRecord | null {
  const value = JSON.parse(storage.getItem(referralStorageKey) || "null") as unknown;
  if (!value || typeof value !== "object" || !("code" in value)
    || typeof value.code !== "string" || !referralCodePattern.test(value.code)) return null;
  const visitedAt = "visitedAt" in value && typeof value.visitedAt === "number" && Number.isFinite(value.visitedAt)
    ? value.visitedAt : 0;
  // Older draft records contained an expiry. The current rule deliberately ignores it.
  return { code: value.code, visitedAt };
}

export function storedReferralCode(storage: Pick<Storage, "getItem">): string | undefined {
  try { return readReferral(storage)?.code; } catch { return undefined; }
}

/** Save only a link that the server has confirmed is valid. */
export function rememberReferral(storage: ReferralStorage, code: string, visitedAt: number): void {
  if (!referralCodePattern.test(code) || !Number.isFinite(visitedAt) || visitedAt < 0) return;
  let previous: ReferralRecord | null = null;
  try { previous = readReferral(storage); } catch { /* Replace malformed stored data. */ }
  // An earlier visit's validation may return after a later visit has already been saved.
  if (previous && previous.visitedAt > visitedAt) return;
  storage.setItem(referralStorageKey, JSON.stringify({ code, visitedAt }));
}
