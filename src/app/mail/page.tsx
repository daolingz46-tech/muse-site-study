import { MuseStorefront } from "@/components/sites/muse/MuseStorefront";
import { SearchContent } from "@/components/sites/muse/SearchContent";
import { pageMetadata } from "@/lib/seo";
export const metadata = pageMetadata("/mail/");
export default function Page() { return <><MuseStorefront initialProduct="mail" /><SearchContent path="/mail/" /></>; }
