import Link from "next/link";
import { Package } from "lucide-react";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { productBulkAction, adjustStockAction } from "@/app/actions/vendor-products";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { ButtonLink } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";
import type { ListingStatus } from "@prisma/client";

export const metadata = { title: "Products" };
const TABS: [string, string][] = [["", "All"], ["PUBLISHED", "Live"], ["PENDING_REVIEW", "In review"], ["DRAFT", "Drafts"], ["REJECTED", "Needs changes"], ["ARCHIVED", "Archived"]];

export default async function Products({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { vendorId } = await requireVendor("catalog");
  const sp = await searchParams;
  const status = TABS.some(([k]) => k === sp.status) && sp.status ? (sp.status as ListingStatus) : undefined;
  const products = await db.product.findMany({
    where: { vendorId, deletedAt: null, ...(status ? { status } : {}), ...(sp.q ? { name: { contains: sp.q, mode: "insensitive" } } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { images: { take: 1, orderBy: { sortOrder: "asc" } }, category: { select: { name: true } }, _count: { select: { variants: true } } },
  });
  return (
    <>
      <PageHeader title="Products" actions={<><ButtonLink href="/vendor-export/products" variant="secondary">Export CSV</ButtonLink><ButtonLink href="/vendor/products/new">Add product</ButtonLink></>} />
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line text-sm">
        {TABS.map(([k, label]) => <Link key={k} href={`/vendor/products${k ? `?status=${k}` : ""}`} className={`-mb-px shrink-0 border-b-2 px-3 py-2 ${(sp.status ?? "") === k ? "border-ink font-medium" : "border-transparent text-ink-muted hover:text-ink"}`}>{label}</Link>)}
      </nav>
      {products.length === 0 ? <EmptyState icon={Package} title="No products here" action={<ButtonLink href="/vendor/products/new">Add your first product</ButtonLink>} /> : (
        <form action={productBulkAction}>
          <div className="mb-3 flex items-center gap-2">
            <Select name="op" className="h-9 w-48" aria-label="Bulk action" defaultValue="submit">
              <option value="submit">Submit for review</option><option value="duplicate">Duplicate</option><option value="archive">Archive</option><option value="delete">Delete</option>
            </Select>
            <SubmitButton variant="secondary" size="sm" className="h-9" confirm="Apply this action to the selected products?">Apply to selected</SubmitButton>
          </div>
          <Table>
            <thead><tr><Th className="w-8"><span className="sr-only">Select</span></Th><Th>Product</Th><Th>Category</Th><Th>Status</Th><Th className="text-right">Price</Th><Th className="text-right">Stock</Th><Th className="text-right">Sold</Th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-canvas">
                  <Td><input type="checkbox" name="ids" value={p.id} aria-label={`Select ${p.name}`} className="size-4 accent-[var(--color-brand)]" /></Td>
                  <Td>
                    <Link href={`/vendor/products/${p.id}`} className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.images[0] ? <img src={p.images[0].url} alt="" className="size-10 rounded object-cover" /> : <span className="size-10 rounded bg-sunken" />}
                      <span><span className="font-medium text-ink hover:text-brand">{p.name}</span>{p.sku && <span className="block text-[12px] text-ink-muted">{p.sku}</span>}</span>
                    </Link>
                  </Td>
                  <Td>{p.category.name}</Td>
                  <Td><StatusBadge status={p.status} />{p.status === "REJECTED" && p.rejectionReason && <p className="mt-1 max-w-48 text-[12px] text-danger">{p.rejectionReason}</p>}</Td>
                  <Td className="tabular text-right">{formatMoney(p.salePriceMinor ?? p.priceMinor)}</Td>
                  <Td className="text-right">
                    {p.type === "DIGITAL" ? <span className="text-ink-muted">Digital</span> : p._count.variants ? <span className="tabular">{p.stockQuantity} <span className="text-ink-muted">({p._count.variants} options)</span></span> : (
                      <span className={`tabular ${p.stockQuantity <= p.lowStockThreshold ? "font-medium text-warning" : ""}`}>{p.stockQuantity}</span>
                    )}
                  </Td>
                  <Td className="tabular text-right">{p.salesCount}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </form>
      )}
      <QuickStock products={products.filter((p) => p.type === "PHYSICAL" && !p._count.variants && p.stockQuantity <= p.lowStockThreshold).slice(0, 5)} />
    </>
  );
}

function QuickStock({ products }: { products: { id: string; name: string; stockQuantity: number }[] }) {
  if (!products.length) return null;
  return (
    <section className="mt-8 rounded-lg border border-line bg-white p-4">
      <h2 className="mb-3 font-semibold">Restock low items</h2>
      <ul className="space-y-2">
        {products.map((p) => (
          <li key={p.id}>
            <form action={adjustStockAction} className="flex items-center gap-3 text-sm">
              <input type="hidden" name="id" value={p.id} />
              <span className="flex-1 truncate">{p.name}</span>
              <input name="stock" type="number" min={0} defaultValue={p.stockQuantity} className="tabular h-8 w-24 rounded-md border border-line-strong px-2" aria-label={`Stock for ${p.name}`} />
              <SubmitButton size="sm" variant="secondary">Update</SubmitButton>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
