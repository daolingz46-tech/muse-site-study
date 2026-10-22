import type { StoreOrder } from "./OrderFlow";

export type CreateStoreOrder = {
  product: "muse" | "muse-token";
  planId?: string;
  email?: string;
  inviteCode?: string;
  method: "alipay" | "wechat";
  acceptedTerms: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readOrder(value: unknown): StoreOrder {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.token !== "string"
    || !value.id || !value.token || typeof value.code !== "string" || !/^\d{4}$/.test(value.code)
    || typeof value.title !== "string" || !Number.isSafeInteger(value.amountCents) || Number(value.amountCents) <= 0
    || !Number.isSafeInteger(value.feeCents) || Number(value.feeCents) < 0
    || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)
    || !["pending", "reported", "processing", "complete", "expired"].includes(String(value.status))
    || !["alipay", "wechat"].includes(String(value.method))
    || (value.product !== "muse" && value.product !== "muse-token")
    || (value.product === "muse" && typeof value.email !== "string")
    || (value.product === "muse-token" && typeof value.inviteCode !== "string")) {
    throw new Error("订单服务返回异常，请联系支持查询，勿重复付款。");
  }
  if (value.qrImageUrl !== undefined && (typeof value.qrImageUrl !== "string"
    || !value.qrImageUrl.startsWith("/api/") || value.qrImageUrl.includes("\\"))) {
    throw new Error("付款码地址异常，请联系支持。");
  }
  if (value.delivery !== undefined && (!isRecord(value.delivery)
    || typeof value.delivery.email !== "string" || typeof value.delivery.password !== "string"
    || typeof value.delivery.codeUrl !== "string")) {
    throw new Error("交付资料返回异常，请联系支持。");
  }
  return value as StoreOrder;
}

async function requestOrder(path: string, payload: unknown): Promise<StoreOrder> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("暂时无法连接订单服务，请稍后重试或联系支持。");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(isRecord(data) && typeof data.message === "string" ? data.message : "订单操作失败，请联系支持。");
  }
  return readOrder(data);
}

export function createStoreOrder(input: CreateStoreOrder, requestId: string) {
  return requestOrder("/api/orders", { ...input, requestId });
}

export async function lookupStoreOrder(id: string, token: string) {
  const order = await requestOrder("/api/orders/lookup", { id, token });
  if (order.id !== id || order.token !== token) throw new Error("订单信息不匹配，请联系支持。");
  return order;
}

export function reportStorePayment(id: string, token: string) {
  return requestOrder("/api/orders/report", { id, token, remarkConfirmed: true });
}

export type OrderSummary = { kind: "summary"; code: string; title: string; amountCents: number; status: StoreOrder["status"] };
export async function findStoreOrder(identifier: string): Promise<OrderSummary | { kind: "full"; order: StoreOrder }> {
  const response = await fetch("/api/orders/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier }), cache: "no-store", signal: AbortSignal.timeout(15000) });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(isRecord(value) && typeof value.message === "string" ? value.message : "查询失败，请稍后重试");
  if (!isRecord(value)) throw new Error("订单查询返回异常");
  if (value.kind === "full") return { kind: "full", order: readOrder(value.order) };
  if (value.kind !== "summary" || value.code !== identifier || typeof value.title !== "string" || !Number.isSafeInteger(value.amountCents) || !["pending", "reported", "processing", "complete", "expired"].includes(String(value.status))) throw new Error("订单查询返回异常");
  return value as OrderSummary;
}
