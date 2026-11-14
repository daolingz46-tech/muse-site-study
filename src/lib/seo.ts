import type { Metadata } from "next";

export const siteUrl = "https://musetoken.store";
export const productPaths = { muse: "/account/", "muse-token": "/token/", gpt: "/gpt/", mail: "/mail/", gmail: "/gmail/" } as const;
export const publicPages = {
  "/": { title: "卡密大王 Muse｜Muse AI 账号与 Muse Token 充值", description: "卡密大王提供 Muse AI 成品账号和 Muse Token 充值。查看商品说明、购买须知、邮箱交付流程及充值教程，按需选择账号或为已有账号补充 Token。" },
  "/account/": { title: "Muse AI 账号｜成品账号与购买须知 · 卡密大王", description: "了解 Muse AI 成品账号及所含 10 亿 Token，比较当前账号方案，查看收件邮箱填写、交付后首次登录检查及售后说明。" },
  "/token/": { title: "Muse Token 充值｜额度选择与充值说明 · 卡密大王", description: "为已有 Muse 账号补充 Token。查看充值额度与当前价格，核对账号邀请码，了解付款核实、充值进度查询及售后流程；本商品不包含账号。" },
  "/gpt/": { title: "GPT 账号与 Plus 代充｜方案说明 · 卡密大王", description: "查看 GPT 账号、资格账号与 Plus 代充方案。购买前核对订阅是否包含、账号资格、首次登录时限和各方案的交付及质保要求。" },
  "/mail/": { title: "Mail.com 邮箱账号｜购买与交付说明 · 卡密大王", description: "查看 Mail.com 邮箱商品与当前价格。购买前阅读商品说明，填写可接收邮件的邮箱，交付后按订单说明检查登录并妥善保存订单。" },
  "/gmail/": { title: "Gmail 邮箱账号｜购买与交付说明 · 卡密大王", description: "查看 Gmail 邮箱账号商品与交付说明。核对当前方案、使用要求和售后条件，填写收件邮箱并在订单中查询交付进度。" },
  "/guides/muse-account/": { title: "Muse AI 账号购买与首次登录教程 · 卡密大王", description: "从选择 Muse AI 账号、填写收件邮箱到查询交付和首次登录检查，逐步了解购买流程、账号信息保管及售后所需资料。" },
  "/guides/muse-token/": { title: "Muse Token 充值教程｜邀请码与到账查询 · 卡密大王", description: "了解 Muse Token 充值前的账号准备、额度选择、邀请码核对、付款核实及充值进度查询，避免把账号商品与 Token 充值混淆。" },
} as const;

export function pageMetadata(path: keyof typeof publicPages): Metadata {
  const page = publicPages[path];
  return { ...page, alternates: { canonical: siteUrl + path }, robots: { index: true, follow: true }, openGraph: { ...page, url: siteUrl + path, siteName: "卡密大王", locale: "zh_CN", type: "website" } };
}
