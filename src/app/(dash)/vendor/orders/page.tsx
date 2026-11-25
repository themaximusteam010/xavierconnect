import Link from "next/link";
import { Inbox } from "lucide-react";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import type { VendorOrderStatus } from "@prisma/client";

export const metadata = { title: "Orders" };
const TABS: [string, string][] = [["", "All"], ["NEW", "New"], ["PROCESSING", "Processing"], ["READY_FOR_DISPATCH", "Ready"], ["SHIPPED", "Shipped"], ["DELIVERED", "Delivered"], ["COMPLETED", "Completed"], ["CANCELLED", "Cancelled"], ["REFUNDED", "Refunded"]];

export default async function VendorOrders({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { vendorId } = await requireVendor("orders");
  const sp = await searchParams;
  const status = TABS.some(([k]) => k && k === sp.status) ? (sp.status as VendorOrderStatus) : undefined;
  const orders = await db.vendorOrder.findMany({
    where: { vendorId, status: status ?? { not: "AWAITING_PAYMENT" } },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { order: { select: { shippingAddress: true, user: { select: { name: true } }, guestEmail: true } }, _count: { select: { items: true } } },
  });
  return (
    <>
      <PageHeader title="Orders" description="Only your part of each customer order is shown here." />
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line text-sm">
        {TABS.map(([k, label]) => <Link key={k} href={`/vendor/orders${k ? `?status=${k}` : ""}`} className={`-mb-px shrink-0 border-b-2 px-3 py-2 ${(sp.status ?? "") === k ? "border-ink font-medium" : "border-transparent text-ink-muted hover:text-ink"}`}>{label}</Link>)}
      </nav>
      {orders.length === 0 ? <EmptyState icon={Inbox} title="No orders here" /> : (
        <Table>
          <thead><tr><Th>Order</Th><Th>Placed</Th><Th>Customer</Th><Th>Ship to</Th><Th>Items</Th><Th>Status</Th><Th className="text-right">Your earnings</Th></tr></thead>
          <tbody>
            {orders.map((o) => {
              const a = o.order.shippingAddress as { fullName?: string; city?: string; state?: string } | null;
              return (
                <tr key={o.id} className="hover:bg-canvas">
                  <Td><Link href={`/vendor/orders/${o.id}`} className="font-medium text-ink hover:text-brand">{o.number}</Link></Td>
                  <Td>{o.createdAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</Td>
                  <Td>{a?.fullName ?? o.order.user?.name ?? "Guest"}</Td>
                  <Td>{a ? `${a.city}, ${a.state}` : "—"}</Td>
                  <Td>{o._count.items}</Td>
                  <Td><StatusBadge status={o.status} /></Td>
                  <Td className="tabular text-right">{formatMoney(o.vendorNetMinor)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
