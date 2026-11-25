import Link from "next/link";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { hasVendorCapability } from "@/server/auth/rbac";
import { vendorBalances } from "@/server/domain/ledger";
import { PageHeader, Stat } from "@/components/ui/page-header";
import { Alert, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { ButtonLink } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Seller dashboard" };

export default async function VendorHome() {
  const { vendor, vendorId, user } = await requireVendor("orders");
  const since = new Date(Date.now() - 30 * 864e5);
  const finance = hasVendorCapability(user.grants, vendorId, "finance");
  const [bal, paid30, orderCounts, products, lowStock, views, visits, recent] = await Promise.all([
    finance ? vendorBalances(db, vendorId) : null,
    db.vendorOrder.aggregate({ where: { vendorId, createdAt: { gte: since }, status: { notIn: ["AWAITING_PAYMENT", "CANCELLED", "REFUNDED"] } }, _sum: { totalMinor: true, vendorNetMinor: true }, _count: true }),
    db.vendorOrder.groupBy({ by: ["status"], where: { vendorId }, _count: true }),
    db.product.groupBy({ by: ["status"], where: { vendorId, deletedAt: null }, _count: true }),
    db.product.findMany({ where: { vendorId, deletedAt: null, type: "PHYSICAL", trackInventory: true, status: "PUBLISHED", stockQuantity: { lte: db.product.fields.lowStockThreshold } }, take: 5, select: { id: true, name: true, stockQuantity: true } }),
    db.analyticsEvent.count({ where: { vendorId, type: "PRODUCT_VIEW", createdAt: { gte: since } } }),
    db.analyticsEvent.count({ where: { vendorId, type: "STORE_VISIT", createdAt: { gte: since } } }),
    db.vendorOrder.findMany({ where: { vendorId, status: { not: "AWAITING_PAYMENT" } }, orderBy: { createdAt: "desc" }, take: 6, include: { _count: { select: { items: true } } } }),
  ]);
  const count = (s: string) => orderCounts.find((o) => o.status === s)?._count ?? 0;
  const pcount = (s: string) => products.find((o) => o.status === s)?._count ?? 0;
  const conversion = views > 0 ? ((paid30._count / views) * 100).toFixed(1) : null;

  return (
    <>
      <PageHeader title="Overview" description="Last 30 days, from your real orders and store traffic." actions={vendor.status === "APPROVED" && <ButtonLink href="/vendor/products/new">Add product</ButtonLink>} />
      {vendor.status !== "APPROVED" && <Alert tone="info" className="mb-6" title="Your application isn't approved yet">You can prepare listings, but buyers can't see them until approval. <Link href="/sell/apply" className="underline">View application</Link></Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales (30 days)" value={formatMoney(paid30._sum.totalMinor ?? 0n)} hint={`${paid30._count} orders`} />
        {bal ? <Stat label="Available to withdraw" value={formatMoney(bal.available)} hint={<Link href="/vendor/earnings" className="text-brand">Earnings →</Link>} /> : <Stat label="Orders to process" value={count("NEW") + count("PROCESSING")} />}
        {bal ? <Stat label="Pending earnings" value={formatMoney(bal.pending)} hint="Released after delivery + hold period" /> : <Stat label="Ready to ship" value={count("READY_FOR_DISPATCH")} />}
        <Stat label="Conversion" value={conversion ? `${conversion}%` : "—"} hint={`${views.toLocaleString()} product views · ${visits.toLocaleString()} store visits`} />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <section>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Recent orders</h2><Link href="/vendor/orders" className="text-sm text-brand hover:underline">All orders</Link></div>
          {recent.length === 0 ? <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-muted">No orders yet. Orders appear here as soon as a buyer pays.</p> : (
            <Table>
              <thead><tr><Th>Order</Th><Th>Date</Th><Th>Items</Th><Th>Status</Th><Th className="text-right">Total</Th></tr></thead>
              <tbody>{recent.map((o) => <tr key={o.id}><Td><Link href={`/vendor/orders/${o.id}`} className="font-medium text-ink hover:text-brand">{o.number}</Link></Td><Td>{o.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td><Td>{o._count.items}</Td><Td><StatusBadge status={o.status} /></Td><Td className="tabular text-right">{formatMoney(o.totalMinor)}</Td></tr>)}</tbody>
            </Table>
          )}
        </section>
        <section className="space-y-6">
          <div className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-3 font-semibold">To do</h2>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><Link href="/vendor/orders?status=NEW" className="hover:text-brand">New orders to accept</Link><span className="tabular font-medium">{count("NEW")}</span></li>
              <li className="flex justify-between"><Link href="/vendor/orders?status=PROCESSING" className="hover:text-brand">Orders being prepared</Link><span className="tabular font-medium">{count("PROCESSING")}</span></li>
              <li className="flex justify-between"><Link href="/vendor/orders?status=READY_FOR_DISPATCH" className="hover:text-brand">Ready to dispatch</Link><span className="tabular font-medium">{count("READY_FOR_DISPATCH")}</span></li>
              <li className="flex justify-between"><Link href="/vendor/products?status=REJECTED" className="hover:text-brand">Listings needing changes</Link><span className="tabular font-medium">{pcount("REJECTED")}</span></li>
              <li className="flex justify-between"><Link href="/vendor/products?status=PENDING_REVIEW" className="hover:text-brand">Listings awaiting review</Link><span className="tabular font-medium">{pcount("PENDING_REVIEW")}</span></li>
            </ul>
          </div>
          <div className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-3 font-semibold">Low stock</h2>
            {lowStock.length === 0 ? <p className="text-sm text-ink-muted">All published products are above their low-stock threshold.</p> : (
              <ul className="space-y-2 text-sm">{lowStock.map((p) => <li key={p.id} className="flex justify-between gap-3"><Link href={`/vendor/products/${p.id}`} className="truncate hover:text-brand">{p.name}</Link><span className={`tabular font-medium ${p.stockQuantity === 0 ? "text-danger" : "text-warning"}`}>{p.stockQuantity} left</span></li>)}</ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
