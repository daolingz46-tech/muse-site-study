import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.STATIC_EXPORT === "true" || process.env.GITHUB_PAGES === "true" ? "export" : undefined,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
