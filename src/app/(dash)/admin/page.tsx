import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { accountBalance, PlatformAccounts } from "@/server/domain/ledger";
import { resolveRange, dayBuckets } from "@/components/admin/date-range";
import { FilterBar } from "@/components/admin/filters";
import { BarChart, HBars, Kpi, Panel, StatusSplit } from "@/components/admin/charts";
import { PageHeader } from "@/components/ui/page-header";
import { Alert, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { countryName } from "@/lib/countries";

export const metadata = { title: "Overview" };

type SP = { range?: string; from?: string; to?: string; denied?: string };
const naira = (kobo: number) => formatMoney(BigInt(Math.round(kobo)));

export default async function AdminOverview({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await guard("admin.access");
  const sp = await searchParams;
  const r = resolveRange(sp);
  const fin = u.permissions.has("finance.view");
  const inRange = { gte: r.from, lt: r.to };

  const [
    customers, vendorsByStatus, products, services, orders, bookings, gmv, payStatus, commission, refunds, payoutsPaid, payoutsFailed,
    disputes, shipCreated, shipDelivered, pendingLedger, revenueByCountry, revenueByCurrency, catSales, topVendors, recentPayments, recentOrders,
    pendingListings, pendingPayouts, alerts, gmvDaily, ordersDaily, vendorsDaily, customersDaily,
  ] = await Promise.all([
    db.user.count({ where: { deletedAt: null, roles: { some: { role: { key: "CUSTOMER" } } } } }),
    db.vendor.groupBy({ by: ["status"], _count: true }),
    db.product.count({ where: { status: "PUBLISHED", deletedAt: null } }),
    db.service.count({ where: { status: "PUBLISHED", deletedAt: null } }),
    db.order.count({ where: { paidAt: inRange } }),
    db.booking.count({ where: { createdAt: inRange, status: { not: "PENDING_PAYMENT" } } }),
    db.order.aggregate({ where: { paidAt: inRange }, _sum: { totalMinor: true } }),
    db.payment.groupBy({ by: ["status"], where: { createdAt: inRange }, _count: true }),
    db.vendorOrder.aggregate({ where: { order: { paidAt: inRange }, status: { notIn: ["REFUNDED", "CANCELLED"] } }, _sum: { commissionMinor: true, vendorNetMinor: true } }),
    db.refund.aggregate({ where: { createdAt: inRange, status: { in: ["COMPLETED", "PROCESSING"] } }, _sum: { amountMinor: true }, _count: true }),
    db.payout.aggregate({ where: { status: "PAID", paidAt: inRange }, _sum: { amountMinor: true }, _count: true }),
    db.payout.count({ where: { status: "FAILED", updatedAt: inRange } }),
    db.dispute.count({ where: { status: { in: ["OPEN", "AWAITING_VENDOR", "UNDER_REVIEW"] } } }),
    db.shipment.count({ where: { createdAt: inRange } }),
    db.shipment.count({ where: { deliveredAt: inRange } }),
    fin ? db.$queryRaw<{ s: bigint | null }[]>`SELECT SUM(e."creditMinor" - e."debitMinor")::bigint AS s FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId" WHERE a.code LIKE 'vendor:%:pending'` : [{ s: null }],
    db.$queryRaw<{ country: string; total: bigint }[]>`SELECT v.country, SUM(vo."totalMinor")::bigint AS total FROM "VendorOrder" vo JOIN "Vendor" v ON v.id = vo."vendorId" JOIN "Order" o ON o.id = vo."orderId" WHERE o."paidAt" >= ${r.from} AND o."paidAt" < ${r.to} GROUP BY v.country ORDER BY total DESC`,
    db.$queryRaw<{ currency: string; total: bigint; settle: string }[]>`SELECT o.currency, vo."settlementCurrency" AS settle, SUM(vo."totalMinor")::bigint AS total FROM "VendorOrder" vo JOIN "Order" o ON o.id = vo."orderId" WHERE o."paidAt" >= ${r.from} AND o."paidAt" < ${r.to} GROUP BY o.currency, vo."settlementCurrency" ORDER BY total DESC`,
    db.$queryRaw<{ name: string; total: bigint }[]>`SELECT COALESCE(pc.name, c.name) AS name, SUM(oi."lineTotalMinor")::bigint AS total FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" JOIN "Product" p ON p.id = oi."productId" JOIN "Category" c ON c.id = p."categoryId" LEFT JOIN "Category" pc ON pc.id = c."parentId" WHERE o."paidAt" >= ${r.from} AND o."paidAt" < ${r.to} GROUP BY 1 ORDER BY total DESC LIMIT 8`,
    db.$queryRaw<{ id: string; name: string; total: bigint }[]>`SELECT v.id, COALESCE(s.name, v."businessName") AS name, SUM(vo."totalMinor")::bigint AS total FROM "VendorOrder" vo JOIN "Vendor" v ON v.id = vo."vendorId" LEFT JOIN "Store" s ON s."vendorId" = v.id JOIN "Order" o ON o.id = vo."orderId" WHERE o."paidAt" >= ${r.from} AND o."paidAt" < ${r.to} AND vo.status NOT IN ('REFUNDED','CANCELLED') GROUP BY 1,2 ORDER BY total DESC LIMIT 8`,
    db.payment.findMany({ orderBy: { createdAt: "desc" }, take: 6, include: { order: { select: { number: true } } } }),
    db.order.findMany({ where: { paymentStatus: { not: "UNPAID" } }, orderBy: { createdAt: "desc" }, take: 6, include: { _count: { select: { vendorOrders: true } } } }),
    db.product.count({ where: { status: "PENDING_REVIEW", deletedAt: null } }),
    db.payout.count({ where: { status: "REQUESTED" } }),
    db.adminAlert.findMany({ where: { resolvedAt: null }, orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }], take: 6 }),
    db.$queryRaw<{ d: Date; v: bigint }[]>`SELECT ("paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Lagos')::date AS d, SUM("totalMinor")::bigint AS v FROM "Order" WHERE "paidAt" >= ${r.from} AND "paidAt" < ${r.to} GROUP BY 1`,
    db.$queryRaw<{ d: Date; v: bigint }[]>`SELECT ("paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Lagos')::date AS d, COUNT(*)::bigint AS v FROM "Order" WHERE "paidAt" >= ${r.from} AND "paidAt" < ${r.to} GROUP BY 1`,
    db.$queryRaw<{ d: Date; v: bigint }[]>`SELECT ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Lagos')::date AS d, COUNT(*)::bigint AS v FROM "Vendor" WHERE "createdAt" >= ${r.from} AND "createdAt" < ${r.to} GROUP BY 1`,
    db.$queryRaw<{ d: Date; v: bigint }[]>`SELECT ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Lagos')::date AS d, COUNT(*)::bigint AS v FROM "User" WHERE "createdAt" >= ${r.from} AND "createdAt" < ${r.to} GROUP BY 1`,
  ]);

  const buckets = dayBuckets(r);
  const series = (rows: { d: Date; v: bigint }[]) => {
    const m = new Map(rows.map((x) => [new Date(x.d).toISOString().slice(0, 10), Number(x.v)]));
    return buckets.map((b) => ({ label: b.label, value: m.get(b.key) ?? 0 }));
  };
  const vc = (s: string) => vendorsByStatus.find((v) => v.status === s)?._count ?? 0;
  const pc = (s: string) => payStatus.find((p) => p.status === s)?._count ?? 0;
  const allVendors = vendorsByStatus.reduce((a, v) => a + v._count, 0);
  const commissionPlatform = fin ? await accountBalance(db, PlatformAccounts.commission.code) : null;

  return (
    <>
      <PageHeader title="Overview" description={`${r.label} · live figures from the database`} />
      {sp.denied && <Alert tone="warning" className="mb-4">You don't have permission to open that page.</Alert>}
      <FilterBar action="/admin" values={sp} fields={[{ type: "range" }]} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Gross merchandise value" value={formatMoney(gmv._sum.totalMinor ?? 0n)} sub={`${orders} paid orders`} />
        {fin && <Kpi label="Commission (period)" value={formatMoney(commission._sum.commissionMinor ?? 0n)} sub={commissionPlatform != null ? `All-time net ${formatMoney(commissionPlatform)}` : undefined} />}
        {fin && <Kpi label="Vendor earnings (period)" value={formatMoney(commission._sum.vendorNetMinor ?? 0n)} />}
        {fin && <Kpi label="Pending settlements" value={formatMoney(pendingLedger[0]?.s ?? 0n)} sub="Vendor pending balances (ledger)" />}
        <Kpi label="Payments" value={`${pc("SUCCEEDED")} ok`} sub={`${pc("FAILED")} failed · ${pc("INITIATED")} pending`} tone={pc("FAILED") > pc("SUCCEEDED") && pc("FAILED") > 0 ? "danger" : undefined} />
        <Kpi label="Refunds" value={formatMoney(refunds._sum.amountMinor ?? 0n)} sub={`${refunds._count} refunds`} />
        <Kpi label="Payouts completed" value={formatMoney(payoutsPaid._sum.amountMinor ?? 0n)} sub={`${payoutsPaid._count} paid · ${payoutsFailed} failed`} tone={payoutsFailed ? "warning" : undefined} />
        <Kpi label="Customers" value={customers.toLocaleString()} />
        <Kpi label="Vendors" value={`${vc("APPROVED")} active`} sub={`${allVendors} total · ${vc("SUBMITTED")} pending`} />
        <Kpi label="Listings" value={`${products} / ${services}`} sub="Live products / services" />
        <Kpi label="Bookings" value={bookings} sub="Period" />
        <Kpi label="Active disputes" value={disputes} tone={disputes ? "warning" : undefined} />
        <Kpi label="Shipping activity" value={`${shipCreated} shipped`} sub={`${shipDelivered} delivered in period`} />
      </div>

      {(alerts.length > 0 || vc("SUBMITTED") || pendingListings || pendingPayouts) ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Panel title="Needs attention" action={<Link href="/admin/integrations" className="text-[12px] text-brand">All alerts</Link>}>
            <ul className="space-y-2 text-[13px]">
              {vc("SUBMITTED") > 0 && <li><Link href="/admin/vendor-verification" className="hover:text-brand">{vc("SUBMITTED")} vendor applications awaiting review</Link></li>}
              {pendingListings > 0 && <li><Link href="/admin/products?status=PENDING_REVIEW" className="hover:text-brand">{pendingListings} listings awaiting moderation</Link></li>}
              {pendingPayouts > 0 && <li><Link href="/admin/payouts?status=REQUESTED" className="hover:text-brand">{pendingPayouts} withdrawal requests to review</Link></li>}
              {alerts.map((a) => <li key={a.id} className="flex items-start gap-2"><StatusBadge status={a.severity === "CRITICAL" ? "FAILED" : a.severity === "WARNING" ? "PENDING_REVIEW" : "PROCESSING"} /><Link href={a.link ?? "/admin/integrations"} className="hover:text-brand">{a.title}</Link></li>)}
            </ul>
          </Panel>
          <Panel title="Revenue by vendor country and currency">
            <div className="grid gap-4 sm:grid-cols-2">
              <HBars data={revenueByCountry.map((x) => ({ label: countryName(x.country), value: Number(x.total) }))} format={naira} />
              <HBars data={revenueByCurrency.map((x) => ({ label: `Paid ${x.currency} → settles ${x.settle}`, value: Number(x.total) }))} format={naira} />
            </div>
          </Panel>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Gross merchandise value per day"><BarChart label="GMV" data={series(gmvDaily)} format={naira} /></Panel>
        <Panel title="Paid orders per day"><BarChart label="Orders" data={series(ordersDaily)} /></Panel>
        <Panel title="New vendors per day"><BarChart label="Vendors" data={series(vendorsDaily)} /></Panel>
        <Panel title="New customer accounts per day"><BarChart label="Customers" data={series(customersDaily)} /></Panel>
        <Panel title="Payment status (period)"><StatusSplit data={[{ label: "Succeeded", value: pc("SUCCEEDED") }, { label: "Pending", value: pc("INITIATED") }, { label: "Failed", value: pc("FAILED") }, { label: "Abandoned", value: pc("ABANDONED") }]} /></Panel>
        <Panel title="Sales by category"><HBars data={catSales.map((c) => ({ label: c.name, value: Number(c.total) }))} format={naira} /></Panel>
        <Panel title="Top vendors"><HBars data={topVendors.map((v) => ({ label: v.name, value: Number(v.total), href: `/admin/vendors/${v.id}` }))} format={naira} /></Panel>
        {fin && (
          <Panel title="Recent transactions" action={<Link href="/admin/payments" className="text-[12px] text-brand">All payments</Link>}>
            {recentPayments.length === 0 ? <p className="text-sm text-ink-muted">No payments yet.</p> : (
              <ul className="divide-y divide-line text-[13px]">{recentPayments.map((p) => <li key={p.id} className="flex items-center justify-between gap-3 py-2"><Link href={`/admin/payments/${p.id}`} className="font-medium hover:text-brand">{p.order.number}</Link><span className="text-ink-muted">{p.provider}</span><StatusBadge status={p.status} /><span className="tabular">{formatMoney(p.amountMinor)}</span></li>)}</ul>
            )}
          </Panel>
        )}
      </div>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between"><h2 className="text-[13px] font-semibold">Recent orders</h2><Link href="/admin/orders" className="text-[12px] text-brand">All orders</Link></div>
        <Table>
          <thead><tr><Th>Order</Th><Th>Placed</Th><Th>Sellers</Th><Th>Payment</Th><Th>Status</Th><Th className="text-right">Total</Th></tr></thead>
          <tbody>{recentOrders.length === 0 ? <tr><Td colSpan={6} className="py-6 text-center text-ink-muted">No orders yet.</Td></tr> : recentOrders.map((o) => (
            <tr key={o.id}><Td><Link href={`/admin/orders/${o.number}`} className="font-medium text-ink hover:text-brand">{o.number}</Link></Td><Td>{o.createdAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</Td><Td>{o._count.vendorOrders}</Td><Td><StatusBadge status={o.paymentStatus} /></Td><Td><StatusBadge status={o.status} /></Td><Td className="tabular text-right">{formatMoney(o.totalMinor)}</Td></tr>
          ))}</tbody>
        </Table>
      </section>
    </>
  );
}
