import type { Metadata } from "next";
import { Workbench } from "@/components/sites/muse/Workbench";
export const metadata: Metadata = { title: "店主工作台 · Muse 商店", robots: { index: false, follow: false } };
export default function AdminPage() { return <Workbench/>; }
