import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { FilterBar, qs } from "@/components/admin/filters";
import { ListingTable } from "@/components/admin/listing-table";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Services" };

export default async function Services({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; category?: string; location?: string; page?: string }> }) {
  await guard("listing.moderate");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.ServiceWhereInput = {
    deletedAt: null,
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(sp.category ? { categoryId: sp.category } : {}),
    ...(sp.location ? { location: sp.location as never } : {}),
    ...(sp.q ? { OR: [{ title: { contains: sp.q, mode: "insensitive" } }, { vendor: { businessName: { contains: sp.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, cats, pending] = await Promise.all([
    db.service.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { category: { select: { name: true } }, vendor: { select: { id: true, businessName: true, country: true } }, packages: { select: { priceMinor: true } } } }),
    db.service.count({ where }),
    db.category.findMany({ where: { kind: "SERVICE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.service.count({ where: { status: "PENDING_REVIEW", deletedAt: null } }),
  ]);
  return (
    <>
      <PageHeader title="Services" description={`${total.toLocaleString()} service listings`} actions={<><ButtonLink variant="secondary" href="/admin/bookings">Bookings</ButtonLink><ButtonLink variant="secondary" href="/admin/listings">Review queue ({pending})</ButtonLink></>} />
      <FilterBar action="/admin/services" values={sp} fields={[
        { type: "search", name: "q", placeholder: "Title or vendor" },
        { type: "select", name: "status", label: "Status", options: [["PUBLISHED", "Published"], ["PENDING_REVIEW", "Pending review"], ["DRAFT", "Draft"], ["REJECTED", "Rejected"], ["ARCHIVED", "Archived"]] },
        { type: "select", name: "category", label: "Category", options: cats.map((c) => [c.id, c.name] as [string, string]) },
        { type: "select", name: "location", label: "Delivered", options: [["ONSITE", "On-site"], ["REMOTE", "Remote"], ["BOTH", "Both"]] },
      ]} />
      <ListingTable rows={rows.map((s) => ({ id: s.id, name: s.title, href: `/services/${s.slug}`, vendor: s.vendor.businessName, vendorId: s.vendor.id, country: s.vendor.country, category: s.category.name, status: s.status, priceMinor: s.packages.length ? s.packages.reduce((m, p) => (p.priceMinor < m ? p.priceMinor : m), s.packages[0].priceMinor) : null, rating: s.ratingAvg, ratingCount: s.ratingCount, featured: s.isFeatured, updatedAt: s.updatedAt }))} />
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(n) => qs("/admin/services", { ...sp, page: n })} />
    </>
  );
}
