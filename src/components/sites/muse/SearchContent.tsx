import Link from "next/link";
import { publicPages } from "@/lib/seo";

export function SearchContent({ path = "/" }: { path?: keyof typeof publicPages }) {
  return <section className="muse-search-content" aria-label="商品介绍与使用教程">
    <h2>{path === "/" ? "卡密大王 Muse 账号与充值服务" : publicPages[path].title.split("｜")[0]}</h2>
    <p>{publicPages[path].description}</p>
    {["/", "/account/", "/token/"].includes(path) ? <p>购买 Muse AI 账号适合尚未准备账号的用户；Muse Token 充值面向已有账号的用户，不包含账号。账号资料和使用教程通过邮箱交付；充值前请核对目标账号的邀请码。商品价格、额度及质保范围以所选方案与购买须知为准。</p> : path === "/gmail/" ? <p>Gmail 商品为邮箱成品号，仅保障收件正常，注册地区及时间随机。收到后请尽快检查；部分方案的售后期限从采购时起算，库存账号交付时该期限可能已结束，购买前请阅读须知并联系支持确认。</p> : path === "/mail/" ? <p>Mail.com 邮箱商品交付邮箱与密码，请先确认你会使用该邮箱服务。核实收款后通过邮件交付；库存不足时由店主联系安排人工发货或售后。</p> : <p>GPT 资格账号、Free 账号、Plus 成品账号与代充的内容不同。资格账号与 Free 账号不含 Plus 订阅；代充须满足对应账号条件。请逐项核对当前方案、交付说明、首次登录时限及质保范围。</p>}
    <nav aria-label="商品与教程"><Link href="/">商店首页</Link><Link href="/account/">Muse AI 账号</Link><Link href="/token/">Muse Token 充值</Link><Link href="/gpt/">GPT 商品</Link><Link href="/mail/">Mail.com 邮箱</Link><Link href="/gmail/">Gmail 邮箱</Link><Link href="/guides/muse-account/">账号购买与首次登录教程</Link><Link href="/guides/muse-token/">Token 充值教程</Link></nav>
    <p>卡密大王为独立商店，商品名称用于说明交易内容，不代表相关平台官方。遇到交付或使用问题，请通过站内支持入口联系售后，勿公开订单私密链接或账号凭据。</p>
  </section>;
}
