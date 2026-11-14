import Link from "next/link";
import { publicPages } from "@/lib/seo";

export function SearchContent({ path = "/" }: { path?: keyof typeof publicPages }) {
  return <section className="muse-search-content" aria-label="商品介绍与使用教程">
    <h2>{path === "/" ? "卡密大王 Muse 账号与充值服务" : publicPages[path].title.split("｜")[0]}</h2>
    <p>{publicPages[path].description}</p>
    <p>购买 Muse AI 账号适合尚未准备账号的用户；Muse Token 充值面向已有账号的用户。Token 充值不包含账号。商品价格、额度、库存和质保范围请以所选方案与购买须知为准，付款后需核实收款并安排交付。</p>
    <nav aria-label="商品与教程"><Link href="/">商店首页</Link><Link href="/account/">Muse AI 账号</Link><Link href="/token/">Muse Token 充值</Link><Link href="/gpt/">GPT 商品</Link><Link href="/mail/">Mail.com 邮箱</Link><Link href="/gmail/">Gmail 邮箱</Link><Link href="/guides/muse-account/">账号购买与首次登录教程</Link><Link href="/guides/muse-token/">Token 充值教程</Link></nav>
    <p>卡密大王为独立商店，商品名称用于说明交易内容，不代表相关平台官方。遇到交付或使用问题，请通过站内支持入口联系售后，勿公开订单私密链接或账号凭据。</p>
  </section>;
}
