import { db } from "@/server/db";
import { Prisma } from "@prisma/client";
import { slugify } from "@/lib/slug";
import { audit } from "./audit";
import { notify } from "./notify";

export class CatalogError extends Error {}

export const publicProductWhere = (): Prisma.ProductWhereInput => ({
  status: "PUBLISHED",
  deletedAt: null,
  vendor: { status: "APPROVED" },
  OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }],
});

export const productCardInclude = {
  images: { orderBy: { sortOrder: "asc" as const }, take: 1 },
  vendor: { select: { verificationLevel: true, store: { select: { name: true, slug: true, city: true, state: true } } } },
} satisfies Prisma.ProductInclude;

export type ProductCardData = Prisma.ProductGetPayload<{ include: typeof productCardInclude }>;

export async function uniqueProductSlug(name: string, excludeId?: string) {
  const base = slugify(name) || "item";
  for (let i = 0; i < 100; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const hit = await db.product.findUnique({ where: { slug }, select: { id: true } });
    if (!hit || hit.id === excludeId) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export interface ShopQuery {
  q?: string;
  category?: string;
  type?: "physical" | "digital";
  min?: string;
  max?: string;
  rating?: string;
  state?: string;
  inStock?: string;
  onSale?: string;
  vendor?: string;
  sort?: string;
  page?: string;
}

export const PAGE_SIZE = 24;

export async function searchProducts(q: ShopQuery) {
  const and: Prisma.ProductWhereInput[] = [publicProductWhere()];
  if (q.q?.trim()) {
    const term = q.q.trim().slice(0, 100);
    and.push({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { brand: { contains: term, mode: "insensitive" } },
        { tags: { has: term.toLowerCase() } },
        { vendor: { store: { name: { contains: term, mode: "insensitive" } } } },
        { category: { name: { contains: term, mode: "insensitive" } } },
      ],
    });
  }
  let category = null;
  if (q.category) {
    category = await db.category.findUnique({ where: { slug: q.category }, include: { children: { select: { id: true } } } });
    if (category) and.push({ categoryId: { in: [category.id, ...category.children.map((c) => c.id)] } });
  }
  if (q.type === "digital") and.push({ type: "DIGITAL" });
  if (q.type === "physical") and.push({ type: "PHYSICAL" });
  const min = q.min && /^\d+$/.test(q.min) ? BigInt(q.min) * 100n : null;
  const max = q.max && /^\d+$/.test(q.max) ? BigInt(q.max) * 100n : null;
  if (min != null) and.push({ priceMinor: { gte: min } });
  if (max != null) and.push({ priceMinor: { lte: max } });
  if (q.rating && /^[1-5]$/.test(q.rating)) and.push({ ratingAvg: { gte: Number(q.rating) } });
  if (q.state) and.push({ vendor: { state: q.state } });
  if (q.inStock === "1") and.push({ OR: [{ type: "DIGITAL" }, { stockQuantity: { gt: 0 } }, { trackInventory: false }] });
  if (q.onSale === "1") and.push({ salePriceMinor: { not: null } });
  if (q.vendor) and.push({ vendor: { store: { slug: q.vendor } } });

  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    q.sort === "price_asc" ? [{ priceMinor: "asc" }]
    : q.sort === "price_desc" ? [{ priceMinor: "desc" }]
    : q.sort === "rating" ? [{ ratingAvg: "desc" }, { ratingCount: "desc" }]
    : q.sort === "popular" ? [{ salesCount: "desc" }, { viewCount: "desc" }]
    : q.sort === "newest" || !q.q ? [{ createdAt: "desc" }]
    : [{ salesCount: "desc" }, { createdAt: "desc" }]; // relevance fallback for text search

  const page = Math.max(1, Math.min(500, Number(q.page) || 1));
  const where = { AND: and };
  const [items, total] = await Promise.all([
    db.product.findMany({ where, orderBy, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: productCardInclude }),
    db.product.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), category };
}

export async function submitProductForReview(vendorId: string, productId: string, actorId: string) {
  const p = await db.product.findFirst({ where: { id: productId, vendorId, deletedAt: null }, include: { images: true, digitalAssets: true } });
  if (!p) throw new CatalogError("Product not found.");
  if (!["DRAFT", "REJECTED", "ARCHIVED"].includes(p.status)) throw new CatalogError("This listing is already submitted or live.");
  if (p.images.length === 0) throw new CatalogError("Add at least one photo before submitting.");
  if (p.type === "DIGITAL" && p.digitalAssets.length === 0) throw new CatalogError("Upload the file buyers will receive.");
  await db.product.update({ where: { id: p.id }, data: { status: "PENDING_REVIEW", rejectionReason: null } });
  await audit(db, { actorId, action: "product.submit", entityType: "Product", entityId: p.id });
}

export async function moderateProduct(productId: string, actorId: string, approve: boolean, reason?: string) {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { vendor: true } });
  if (p.status !== "PENDING_REVIEW") throw new CatalogError("Only listings awaiting review can be moderated.");
  const status = approve ? "PUBLISHED" : "REJECTED";
  await db.product.update({ where: { id: productId }, data: { status, rejectionReason: approve ? null : reason ?? "Does not meet listing guidelines" } });
  await audit(db, { actorId, action: approve ? "product.approve" : "product.reject", entityType: "Product", entityId: productId, before: { status: p.status }, after: { status, reason } });
  await notify(db, {
    userId: p.vendor.ownerId,
    type: "listing.review",
    title: approve ? `"${p.name}" is live` : `"${p.name}" needs changes`,
    body: approve ? "Your listing has been approved and is now visible to buyers." : reason ?? "Your listing was not approved.",
    link: `/vendor/products/${p.id}`,
    email: !approve,
  });
}

export async function recomputeProductRating(productId: string) {
  const agg = await db.review.aggregate({ where: { productId, status: "PUBLISHED" }, _avg: { rating: true }, _count: true });
  await db.product.update({ where: { id: productId }, data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count } });
}
