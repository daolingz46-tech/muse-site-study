import { MuseStorefront } from "@/components/sites/muse/MuseStorefront";
import { SearchContent } from "@/components/sites/muse/SearchContent";
import { pageMetadata } from "@/lib/seo";
export const metadata = pageMetadata("/gmail/");
export default function Page() { return <><MuseStorefront initialProduct="gmail" /><SearchContent path="/gmail/" /></>; }
