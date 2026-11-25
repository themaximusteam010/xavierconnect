import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/account", "/vendor", "/admin", "/delivery", "/cart", "/checkout", "/api", "/download", "/admin-docs", "/vendor-export", "/compare"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
