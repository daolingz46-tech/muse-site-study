import { MuseStorefront } from "@/components/sites/muse/MuseStorefront";
import { SearchContent } from "@/components/sites/muse/SearchContent";
import { pageMetadata } from "@/lib/seo";
export const metadata = pageMetadata("/gpt/");
export default function Page() { return <><MuseStorefront initialProduct="gpt" /><SearchContent path="/gpt/" /></>; }
