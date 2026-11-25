import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { accountBalance, PlatformAccounts } from "@/server/domain/ledger";
import { PageHeader, Stat } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/feedback";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Admin" };

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const u = await requireUser("/admin");
  const sp = await searchParams;
  const since = new Date(Date.now() - 30 * 864e5);
  const prev = new Date(Date.now() - 60 * 864e5);
  const fin = u.permissions.has("finance.view");
  const [gmv30, gmvPrev, orders30, customers, vendors, pendingApps, products, services, bookings, pendingPayouts, refunds, commission, newUsers30] = await Promise.all([
    db.order.aggregate({ where: { paidAt: { gte: since } }, _sum: { totalMinor: true } }),
    db.order.aggregate({ where: { paidAt: { gte: prev, lt: since } }, _sum: { totalMinor: true } }),
    db.order.count({ where: { paidAt: { gte: since } } }),
    db.user.count({ where: { deletedAt: null } }),
    db.vendor.groupBy({ by: ["status"], _count: true }),
    db.vendor.count({ where: { status: "SUBMITTED" } }),
    db.product.count({ where: { status: "PUBLISHED", deletedAt: null } }),
    db.service.count({ where: { status: "PUBLISHED", deletedAt: null } }),
    db.booking.count({ where: { status: { in: ["REQUESTED", "CONFIRMED"] } } }),
    db.payout.aggregate({ where: { status: "REQUESTED" }, _sum: { amountMinor: true }, _count: true }),
    db.refund.aggregate({ where: { createdAt: { gte: since } }, _sum: { amountMinor: true }, _count: true }),
    fin ? accountBalance(db, PlatformAccounts.commission.code) : null,
    db.user.count({ where: { createdAt: { gte: since } } }),
  ]);
  const gmv = gmv30._sum.totalMinor ?? 0n;
  const p = gmvPrev._sum.totalMinor ?? 0n;
  const growth = p > 0n ? `${Number(((gmv - p) * 1000n) / p) / 10}% vs previous 30 days` : "No prior-period sales";
  const vc = (s: string) => vendors.find((v) => v.status === s)?._count ?? 0;
  return (
    <>
      <PageHeader title="Overview" description="Live figures from the database. Last 30 days unless stated." />
      {sp.denied && <Alert tone="warning" className="mb-6">You don't have permission to open that page.</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Gross sales (paid)" value={formatMoney(gmv)} hint={growth} />
        <Stat label="Paid orders" value={orders30} />
        {commission != null && <Stat label="Commission earned (all time, net of refunds)" value={formatMoney(commission)} />}
        <Stat label="Refunds" value={formatMoney(refunds._sum.amountMinor ?? 0n)} hint={`${refunds._count} refunds`} />
        <Stat label="Active vendors" value={vc("APPROVED")} hint={`${vc("SUSPENDED")} suspended`} />
        <Stat label="Users" value={customers.toLocaleString()} hint={`${newUsers30} new`} />
        <Stat label="Live listings" value={`${products} / ${services}`} hint="Products / services" />
        <Stat label="Open bookings" value={bookings} />
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {pendingApps > 0 && <Link href="/admin/vendors?status=SUBMITTED" className="rounded-lg border border-amber-200 bg-warning-soft p-4 text-sm text-warning hover:border-amber-300"><b className="tabular text-lg">{pendingApps}</b><br />vendor applications awaiting review</Link>}
        {pendingPayouts._count > 0 && <Link href="/admin/finance" className="rounded-lg border border-amber-200 bg-warning-soft p-4 text-sm text-warning hover:border-amber-300"><b className="tabular text-lg">{formatMoney(pendingPayouts._sum.amountMinor ?? 0n)}</b><br />in {pendingPayouts._count} withdrawal requests</Link>}
      </div>
    </>
  );
}
