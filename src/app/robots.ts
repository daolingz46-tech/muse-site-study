import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";
export const dynamic = "force-static";
export default function robots(): MetadataRoute.Robots {
  // Private pages remain crawlable so search engines can observe noindex.
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${siteUrl}/sitemap.xml` };
}
