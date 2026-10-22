import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { storeName } from "@/components/sites/muse/catalog";

const geist = localFont({
  src: "../../public/sites/muse/geist-latin.woff2",
  variable: "--font-geist",
  display: "swap",
});

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_PUBLIC_DEMO === "true" ? "Muse 页面学习项目（非官方）" : `${storeName} · 账号与 Token 充值`,
  description: process.env.NEXT_PUBLIC_PUBLIC_DEMO === "true"
    ? "非官方界面学习项目，不收集信息，不提供订单或付款功能。"
    : "Muse AI 成品账号与 Muse Token 充值，支持支付宝、微信支付，售后联系 QQ：3557785836。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" className={geist.variable}><body>{children}</body></html>;
}
