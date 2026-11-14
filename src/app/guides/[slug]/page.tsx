import { notFound } from "next/navigation";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import "@/components/sites/muse/muse.css";

const guides = {
  "muse-account": { title: "Muse AI 账号购买与首次登录教程", steps: [
    "先确认需要的是成品账号。账号商品包含所标注的 Token；已有账号只需补充额度时，请查看 Token 充值商品。",
    "进入 Muse AI 账号页面，选择当前方案，阅读对应的首次登录时限和质保范围。不同方案的售后条件可能不同。",
    "填写可以正常收信的邮箱并仔细核对。按页面流程创建订单、完成付款，并保留订单编号与私密查询链接。",
    "等待店主核实收款并安排交付。通过原浏览器的订单查询入口检查进度，同时检查收件箱和垃圾邮件。付款反馈并不等于已经核实到账。",
    "收到账号后，按交付邮件中的使用链接和说明登录，在所购方案要求的时间内检查账号与额度。按照该方案指引处理邮箱和安全设置。",
    "如有登录或交付问题，保留订单号、报错时间及截图，通过站内支持入口联系售后。不要在公开评论中发送密码或订单私密链接。",
  ] },
  "muse-token": { title: "Muse Token 充值教程", steps: [
    "准备已有的 Muse 账号。本商品只补充 Token，不提供新账号；没有账号时，请先查看 Muse AI 账号商品。",
    "在需要充值的账号内找到邀请码。复制后核对目标账号，避免使用其他账号的邀请码；不确定时先联系站内支持。",
    "进入 Muse Token 充值页面，选择所需额度，核对当前售价并阅读购买须知。填写该账号邀请码及可接收通知的邮箱。",
    "创建订单后按页面提示付款并保留订单信息。店主核实收款后安排充值；以订单状态及实际账号额度为准。",
    "在原浏览器使用订单查询入口查看进度，并登录目标 Muse 账号检查 Token 变化。若状态或额度有疑问，请提供订单号联系售后，避免重复下单。",
    "不要把支付成功截图当作充值完成凭证，也不要公开邀请码、订单链接或账号登录信息。",
  ] },
} as const;
export function generateStaticParams() { return Object.keys(guides).map(slug => ({ slug })); }
export const dynamicParams = false;
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(slug in guides)) notFound();
  return pageMetadata(`/guides/${slug as keyof typeof guides}/`);
}
export default async function Guide({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(slug in guides)) notFound();
  const guide = guides[slug as keyof typeof guides];
  return <main className="muse-search-content"><h1>{guide.title}</h1><p>本教程说明卡密大王站内购买流程。具体价格、额度和售后条件以当前商品页及所选方案为准。</p><ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol><nav><Link href="/account/">查看 Muse AI 账号</Link><Link href="/token/">查看 Muse Token 充值</Link><Link href="/">返回商店</Link></nav></main>;
}
