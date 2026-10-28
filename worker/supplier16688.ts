/** Server-side 16688 Open API client. Never expose credentials to the browser. */
export type SupplierCredentials = { appId: string; secret: string };
export const MUSE_ACCOUNT_SUPPLIER = { goodsNo: "G72563978", priceCents: 1050 } as const;
export const GPT_SUPPLIER_PRODUCTS = {
  halfPriceAccount: { goodsNo: "G26126458", priceCents: 1500, title: "GPT · 两个月半价资格账号" },
  halfPriceAccountOneMonth: { goodsNo: "G75777360", priceCents: 1500, title: "GPT · 一个月半价资格账号" },
  halfPriceTopup: { goodsNo: "G69571468", priceCents: 7500, title: "GPT · 一个月半价代充" },
  philippinesTopup: { goodsNo: "G19335525", priceCents: 12800, title: "GPT · 菲律宾正价代充" },
} as const;
type Parameter = string | number | boolean | null | Parameter[] | { [key: string]: Parameter };

function ordered(value: Parameter): Parameter {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}

export async function supplierRequest(credentials: SupplierCredentials, controller: string, action: string, data: Record<string, Parameter>) {
  if (!credentials.appId || !credentials.secret) throw new Error("supplier_credentials_missing");
  const params: Record<string, Parameter> = { ...data, app_id: credentials.appId, timestamp: Math.floor(Date.now() / 1000), nonce: crypto.randomUUID().replaceAll("-", "") };
  const canonical = Object.keys(params).sort().map(key => {
    const value = params[key];
    return `${key}=${value !== null && typeof value === "object" ? JSON.stringify(ordered(value)) : String(value)}`;
  }).join("&");
  const message = `POST\n${controller.toLowerCase()}\n${action.toLowerCase()}\n${canonical}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(credentials.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const sign = Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");
  const response = await fetch(`https://www.16688.com.cn/openApi/${controller}/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...params, sign }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`supplier_http_${response.status}`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("code" in result)) throw new Error("supplier_invalid_response");
  return result;
}
