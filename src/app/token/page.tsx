import { MuseStorefront } from "@/components/sites/muse/MuseStorefront";
import { SearchContent } from "@/components/sites/muse/SearchContent";
import { pageMetadata } from "@/lib/seo";
export const metadata = pageMetadata("/token/");
export default function Page() { return <><MuseStorefront initialProduct="muse-token" /><SearchContent path="/token/" /></>; }
