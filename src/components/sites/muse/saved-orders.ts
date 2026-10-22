import type { StoreOrder } from "./OrderFlow";
export type SavedOrder = Pick<StoreOrder, "id" | "token" | "code" | "title">;
const key = "muse-order-receipts-v1";
export function readSavedOrders(): SavedOrder[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((r): r is SavedOrder => r && typeof r.id === "string" && /^M[a-f0-9]{32}$/.test(r.id) && typeof r.token === "string" && r.token.length === 64 && typeof r.code === "string" && /^\d{4}$/.test(r.code) && typeof r.title === "string").slice(0, 30);
  } catch { return []; }
}
export function saveOrder(order: StoreOrder) {
  const refs = [{ id: order.id, token: order.token, code: order.code, title: order.title }, ...readSavedOrders().filter(r => r.id !== order.id)].slice(0, 30);
  try { localStorage.setItem(key, JSON.stringify(refs)); } catch { /* Private browsing may disable storage; order links still work. */ }
  return refs;
}
