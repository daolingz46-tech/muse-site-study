import type { Metadata } from "next";
import { AgentAdminPage } from "@/components/sites/muse/AgentAdminPage";

export const metadata: Metadata = { title: "代理管理 · 卡密大王", robots: { index: false, follow: false } };
export default function Page() { return <AgentAdminPage />; }
