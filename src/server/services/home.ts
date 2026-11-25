import { db } from "@/server/db";
import { productCardInclude, publicProductWhere } from "./catalog";
import type { Prisma } from "@prisma/client";

export type RailSource = "featured" | "new" | "bestsellers" | "trending" | "deals" | "digital";

export async function productRail(source: RailSource, limit = 10) {
  const where: Prisma.ProductWhereInput = { AND: [publicProductWhere()] };
  let orderBy: Prisma.ProductOrderByWithRelationInput[] = [{ createdAt: "desc" }];
  switch (source) {
    case "featured": (where.AND as Prisma.ProductWhereInput[]).push({ isFeatured: true }); break;
    case "bestsellers": (where.AND as Prisma.ProductWhereInput[]).push({ salesCount: { gt: 0 } }); orderBy = [{ salesCount: "desc" }, { createdAt: "desc" }]; break;
    case "trending": (where.AND as Prisma.ProductWhereInput[]).push({ viewCount: { gt: 0 } }); orderBy = [{ viewCount: "desc" }, { createdAt: "desc" }]; break;
    case "deals": (where.AND as Prisma.ProductWhereInput[]).push({ salePriceMinor: { not: null } }); break;
    case "digital": (where.AND as Prisma.ProductWhereInput[]).push({ type: "DIGITAL" }); break;
  }
  return db.product.findMany({ where, orderBy, take: limit, include: productCardInclude });
}

export async function homepageSections() {
  return db.homepageSection.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
}

export async function marketplaceFacts() {
  const [products, stores, services] = await Promise.all([
    db.product.count({ where: publicProductWhere() }),
    db.store.count({ where: { vendor: { status: "APPROVED" } } }),
    db.service.count({ where: { status: "PUBLISHED", deletedAt: null, vendor: { status: "APPROVED" } } }),
  ]);
  return { products, stores, services };
}
