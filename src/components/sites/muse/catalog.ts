export { tokenPlans, accountPriceCents, accountTitle } from "@/lib/products";

export const orderHandlingTime = "确认收款后 10 分钟内处理完毕";

export const tokenTerms = [
  { title: "不包含账号", body: "本商品仅提供 Token 充值，请先准备已有的 Muse 账号。" },
  { title: "填写账号邀请码", body: "请填写需要充值的账号邀请码，提交前仔细核对。" },
  { title: "处理时间", body: `${orderHandlingTime}。` },
];

export type OrderDetails = {
  title: string;
  amountCents: number;
  feeCents: number;
} & ({ product: "muse" | "gpt"; email: string } | { product: "muse-token"; inviteCode: string });

export function formatMoney(cents: number) {
  return (cents / 100).toFixed(2);
}
export const supportQQ = "3557785836";
export const storeName = process.env.NEXT_PUBLIC_STORE_NAME || "卡密大王";

