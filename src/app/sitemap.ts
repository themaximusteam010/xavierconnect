import type { MetadataRoute } from "next";
import { db } from "@/server/db";
import { publicProductWhere } from "@/server/services/catalog";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const [products, stores, services, cats, pages, posts] = await Promise.all([
    db.product.findMany({ where: publicProductWhere(), select: { slug: true, updatedAt: true }, take: 45000 }),
    db.store.findMany({ where: { vendor: { status: "APPROVED" } }, select: { slug: true, updatedAt: true } }),
    db.service.findMany({ where: { status: "PUBLISHED", deletedAt: null }, select: { slug: true, updatedAt: true } }),
    db.category.findMany({ where: { kind: { not: "SERVICE" } }, select: { slug: true } }),
    db.cmsPage.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } }),
    db.blogPost.findMany({ where: { publishedAt: { lte: new Date() } }, select: { slug: true, updatedAt: true } }),
  ]);
  return [
    ...["", "/shop", "/services", "/stores", "/sell", "/help", "/faq", "/blog", "/contact"].map((p) => ({ url: `${base}${p}`, changeFrequency: "daily" as const })),
    ...cats.map((c) => ({ url: `${base}/shop?category=${c.slug}` })),
    ...products.map((p) => ({ url: `${base}/p/${p.slug}`, lastModified: p.updatedAt })),
    ...stores.map((s) => ({ url: `${base}/store/${s.slug}`, lastModified: s.updatedAt })),
    ...services.map((s) => ({ url: `${base}/services/${s.slug}`, lastModified: s.updatedAt })),
    ...pages.filter((p) => p.slug !== "about").map((p) => ({ url: `${base}/legal/${p.slug}`, lastModified: p.updatedAt })),
    ...posts.map((p) => ({ url: `${base}/blog/${p.slug}`, lastModified: p.updatedAt })),
  ];
}
