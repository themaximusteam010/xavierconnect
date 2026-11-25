import Link from "next/link";
import { Package } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { ButtonLink } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "My orders" };

export default async function Orders() {
  const u = await requireUser("/account/orders");
  const orders = await db.order.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 100, include: { _count: { select: { items: true, vendorOrders: true } } } });
  return (
    <>
      <PageHeader title="Orders" />
      {orders.length === 0 ? <EmptyState icon={Package} title="No orders yet" action={<ButtonLink href="/shop">Start shopping</ButtonLink>} /> : (
        <Table>
          <thead><tr><Th>Order</Th><Th>Placed</Th><Th>Sellers</Th><Th>Status</Th><Th className="text-right">Total</Th></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-canvas">
                <Td><Link href={`/account/orders/${o.number}`} className="font-medium text-ink hover:text-brand">{o.number}</Link></Td>
                <Td>{o.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td>
                <Td>{o._count.vendorOrders}</Td>
                <Td><StatusBadge status={o.status} /></Td>
                <Td className="tabular text-right">{formatMoney(o.totalMinor)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
