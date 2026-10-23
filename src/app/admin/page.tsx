import type { Metadata } from "next";
import { Workbench } from "@/components/sites/muse/Workbench";
export const metadata: Metadata = {
  title: "店主工作台 · Muse 商店",
  robots: { index: false, follow: false },
  manifest: "https://musetoken.store/admin/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Muse 工作台", statusBarStyle: "default" },
  icons: { apple: "https://musetoken.store/sites/muse/store-logo.png" },
};
export default function AdminPage() { return <Workbench/>; }
