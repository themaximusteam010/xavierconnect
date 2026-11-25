import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { FilterBar, qs } from "@/components/admin/filters";
import { ListingTable } from "@/components/admin/listing-table";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import type { Prisma } from "@prisma/client";

export type ProductSP = { q?: string; status?: string; category?: string; stock?: string; featured?: string; page?: string; ok?: string; error?: string };

export async function ProductListPage({ sp, type, base, title }: { sp: ProductSP; type: "PHYSICAL" | "DIGITAL"; base: string; title: string }) {
  const u = await guard("listing.moderate");
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.ProductWhereInput = {
    type, deletedAt: null,
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(sp.category ? { categoryId: sp.category } : {}),
    ...(sp.featured ? { isFeatured: true } : {}),
    ...(sp.stock === "out" ? { trackInventory: true, stockQuantity: { lte: 0 } } : sp.stock === "low" ? { trackInventory: true, stockQuantity: { gt: 0, lte: 5 } } : {}),
    ...(sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { sku: { contains: sp.q, mode: "insensitive" } }, { vendor: { businessName: { contains: sp.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, cats, pending] = await Promise.all([
    db.product.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { category: { select: { name: true } }, vendor: { select: { id: true, businessName: true, country: true } } } }),
    db.product.count({ where }),
    db.category.findMany({ where: { kind: type === "DIGITAL" ? "DIGITAL" : "PRODUCT" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.product.count({ where: { type, status: "PENDING_REVIEW", deletedAt: null } }),
  ]);
  return (
    <>
      <PageHeader title={title} description={`${total.toLocaleString()} listings`} actions={<ButtonLink variant="secondary" href="/admin/listings">Review queue ({pending})</ButtonLink>} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <FilterBar action={base} values={sp} fields={[
        { type: "search", name: "q", placeholder: "Name, SKU or vendor" },
        { type: "select", name: "status", label: "Status", options: [["PUBLISHED", "Published"], ["PENDING_REVIEW", "Pending review"], ["DRAFT", "Draft"], ["REJECTED", "Rejected"], ["ARCHIVED", "Archived"]] },
        { type: "select", name: "category", label: "Category", options: cats.map((c) => [c.id, c.name] as [string, string]) },
        ...(type === "PHYSICAL" ? [{ type: "select" as const, name: "stock", label: "Stock", options: [["low", "Low (1–5)"], ["out", "Out of stock"]] as [string, string][] }] : []),
        { type: "select", name: "featured", label: "Featured", options: [["1", "Featured only"]] },
      ]} />
      <ListingTable showStock={type === "PHYSICAL"} canFeature={u.permissions.has("cms.manage")} rows={rows.map((p) => ({ id: p.id, name: p.name, href: `/p/${p.slug}`, vendor: p.vendor.businessName, vendorId: p.vendor.id, country: p.vendor.country, category: p.category.name, status: p.status, priceMinor: p.salePriceMinor ?? p.priceMinor, stock: p.trackInventory ? p.stockQuantity : null, rating: p.ratingAvg, ratingCount: p.ratingCount, featured: p.isFeatured, updatedAt: p.updatedAt }))} />
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(n) => qs(base, { ...sp, page: n, ok: undefined, error: undefined })} />
    </>
  );
}
