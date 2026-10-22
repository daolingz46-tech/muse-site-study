export const tokenPlans = [
  { id: "300", label: "300亿 Token", amountCents: 7900 },
  { id: "200", label: "200亿 Token", amountCents: 5200 },
  { id: "150", label: "150亿 Token", amountCents: 4500 },
  { id: "100", label: "100亿 Token", amountCents: 3000 },
] as const;

export const tokenTerms = [
  { title: "不包含账号", body: "本商品仅提供 Token 充值，请先准备已有的 Muse 账号。" },
  { title: "填写账号邀请码", body: "请填写需要充值的账号邀请码，提交前仔细核对。" },
  { title: "到账时间", body: "支付后 10 分钟内到账，拥挤时可能需要 30 分钟。" },
];

export type OrderDetails = {
  title: string;
  amountCents: number;
  feeCents: number;
} & ({ product: "muse"; email: string } | { product: "muse-token"; inviteCode: string });

export function formatMoney(cents: number) {
  return (cents / 100).toFixed(2);
}
