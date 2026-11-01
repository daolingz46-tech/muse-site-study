import type { Metadata } from "next";
import { AgentWorkbench } from "@/components/sites/muse/AgentWorkbench";

export const metadata: Metadata = {
  title: "代理工作台 · 卡密大王",
  robots: { index: false, follow: false },
};

export default function AgentPage() { return <AgentWorkbench />; }
