import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { publicProductWhere } from "@/server/services/catalog";
import { rateLimit } from "@/server/rate-limit";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return NextResponse.json({ items: [] });
  if (!(await rateLimit("suggest", 120, 60))) return NextResponse.json({ items: [] }, { status: 429 });
  const [products, stores, cats] = await Promise.all([
    db.product.findMany({ where: { AND: [publicProductWhere(), { OR: [{ name: { contains: q, mode: "insensitive" } }, { brand: { contains: q, mode: "insensitive" } }] }] }, select: { name: true, slug: true }, orderBy: { salesCount: "desc" }, take: 6 }),
    db.store.findMany({ where: { name: { contains: q, mode: "insensitive" }, vendor: { status: "APPROVED" } }, select: { name: true, slug: true }, take: 3 }),
    db.category.findMany({ where: { name: { contains: q, mode: "insensitive" } }, select: { name: true, slug: true, kind: true }, take: 3 }),
  ]);
  return NextResponse.json({
    items: [
      ...cats.map((c) => ({ type: "category", label: c.name, href: c.kind === "SERVICE" ? `/services?category=${c.slug}` : `/shop?category=${c.slug}` })),
      ...products.map((p) => ({ type: "product", label: p.name, href: `/p/${p.slug}` })),
      ...stores.map((s) => ({ type: "store", label: s.name, href: `/store/${s.slug}` })),
    ],
  });
}
