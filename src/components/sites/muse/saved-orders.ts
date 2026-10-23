import type { StoreOrder } from "./OrderFlow";
export type SavedOrder = Pick<StoreOrder, "id" | "token" | "code" | "title">;
const key = "muse-order-receipts-v1";
function validOrders(value: unknown): SavedOrder[] {
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is SavedOrder => r && typeof r.id === "string" && /^M[a-f0-9]{32}$/.test(r.id) && typeof r.token === "string" && /^[a-f0-9]{64}$/.test(r.token) && typeof r.code === "string" && /^\d{4}$/.test(r.code) && typeof r.title === "string").slice(0, 30);
}
export function readSavedOrders(): SavedOrder[] {
  try { return validOrders(JSON.parse(localStorage.getItem(key) || "[]")); }
  catch { return []; }
}
export function importSavedOrders(value: unknown): SavedOrder[] {
  const current = readSavedOrders();
  const merged = [...current, ...validOrders(value).filter(order => !current.some(saved => saved.id === order.id))].slice(0, 30);
  try { localStorage.setItem(key, JSON.stringify(merged)); } catch { /* Private browsing may disable storage. */ }
  return merged;
}
export function saveOrder(order: StoreOrder) {
  const refs = [{ id: order.id, token: order.token, code: order.code, title: order.title }, ...readSavedOrders().filter(r => r.id !== order.id)].slice(0, 30);
  try { localStorage.setItem(key, JSON.stringify(refs)); } catch { /* Private browsing may disable storage; order links still work. */ }
  return refs;
}
