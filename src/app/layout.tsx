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
  title: `${storeName} · 账号与 Token 充值`,
  description: "Muse AI 成品账号与 Muse Token 充值，支持支付宝、微信支付，售后联系 QQ：3557785836。",
  referrer: "no-referrer",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" className={geist.variable}><body>{children}</body></html>;
}
