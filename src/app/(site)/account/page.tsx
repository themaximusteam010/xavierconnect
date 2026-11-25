import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { PageHeader, Stat } from "@/components/ui/page-header";
import { Alert, StatusBadge } from "@/components/ui/feedback";
import { formatMoney } from "@/lib/money";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "My account" };

export default async function AccountHome() {
  const u = await requireUser("/account");
  const [orders, openOrders, wish, downloads, vendor] = await Promise.all([
    db.order.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.order.count({ where: { userId: u.id, status: { in: ["PAID", "PARTIALLY_FULFILLED"] } } }),
    db.wishlistItem.count({ where: { userId: u.id } }),
    db.downloadGrant.count({ where: { userId: u.id, revokedAt: null } }),
    db.vendor.findFirst({ where: { ownerId: u.id }, select: { status: true } }),
  ]);
  return (
    <>
      <PageHeader title={`Hello, ${u.name.split(" ")[0]}`} description="Your orders, downloads and saved items." />
      {!u.emailVerified && <Alert tone="warning" className="mb-6" title="Confirm your email">Check your inbox for a confirmation link. <Link href="/verify-email" className="underline">Resend it</Link>.</Alert>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Orders in progress" value={openOrders} />
        <Stat label="Wishlist" value={wish} />
        <Stat label="Downloads" value={downloads} />
        <Stat label="Seller status" value={vendor ? vendor.status.replace(/_/g, " ").toLowerCase() : "—"} />
      </div>
      <div className="mt-10">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Recent orders</h2><Link href="/account/orders" className="text-sm text-brand hover:underline">All orders</Link></div>
        {orders.length === 0 ? <p className="text-sm text-ink-muted">No orders yet.</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {orders.map((o) => (
              <li key={o.id}><Link href={`/account/orders/${o.number}`} className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-canvas">
                <span className="font-medium">{o.number}</span><span className="hidden text-ink-muted sm:block">{o.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</span><StatusBadge status={o.status} /><span className="tabular">{formatMoney(o.totalMinor)}</span>
              </Link></li>
            ))}
          </ul>
        )}
      </div>
      {!vendor && (
        <div className="mt-10 flex flex-col gap-3 rounded-lg bg-canvas p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-medium">Have something to sell?</p><p className="text-sm text-ink-muted">Open a store with the same account.</p></div>
          <ButtonLink href="/sell" variant="secondary">Become a vendor</ButtonLink>
        </div>
      )}
    </>
  );
}
