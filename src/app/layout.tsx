import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geist = localFont({
  src: "../../public/sites/muse/geist-latin.woff2",
  variable: "--font-geist",
  display: "swap",
});

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_PUBLIC_DEMO === "true" ? "Muse 页面学习项目（非官方）" : "Muse · GPTibo",
  description: process.env.NEXT_PUBLIC_PUBLIC_DEMO === "true"
    ? "非官方界面学习项目，不收集信息，不提供订单或付款功能。"
    : "Muse AI 与 Muse Token。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" className={geist.variable}><body>{children}</body></html>;
}
