import type { Metadata } from "next";
import { AgentWorkbench } from "@/components/sites/muse/AgentWorkbench";

export const metadata: Metadata = {
  title: "代理工作台 · 卡密大王",
  manifest: "https://musetoken.store/agent/manifest.webmanifest",
  appleWebApp: { capable: true, title: "代理工作台", statusBarStyle: "default" },
  icons: { apple: "https://musetoken.store/sites/muse/store-logo.png" },
  robots: { index: false, follow: false },
};

export default function AgentPage() { return <AgentWorkbench />; }
