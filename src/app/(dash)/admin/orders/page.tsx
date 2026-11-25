import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Orders" };

export default async function AdminOrders({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await guard("order.view_all");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = sp.q ? { OR: [{ number: { contains: sp.q.toUpperCase() } }, { guestEmail: { contains: sp.q, mode: "insensitive" as const } }, { user: { email: { contains: sp.q, mode: "insensitive" as const } } }] } : {};
  const [orders, total] = await Promise.all([
    db.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { user: { select: { email: true } }, _count: { select: { vendorOrders: true } } } }),
    db.order.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Orders" description={`${total.toLocaleString()} orders`} actions={<form><Input name="q" defaultValue={sp.q} placeholder="Order number or email" className="h-9 w-64" /></form>} />
      <Table>
        <thead><tr><Th>Order</Th><Th>Placed</Th><Th>Customer</Th><Th>Sellers</Th><Th>Payment</Th><Th>Status</Th><Th className="text-right">Total</Th></tr></thead>
        <tbody>{orders.map((o) => (
          <tr key={o.id} className="hover:bg-canvas">
            <Td><Link href={`/admin/orders/${o.number}`} className="font-medium text-ink hover:text-brand">{o.number}</Link></Td>
            <Td>{o.createdAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</Td>
            <Td>{o.user?.email ?? `${o.guestEmail} (guest)`}</Td><Td className="tabular">{o._count.vendorOrders}</Td>
            <Td><StatusBadge status={o.paymentStatus} /></Td><Td><StatusBadge status={o.status} /></Td><Td className="tabular text-right">{formatMoney(o.totalMinor)}</Td>
          </tr>
        ))}</tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(p) => `/admin/orders?page=${p}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`} />
    </>
  );
}
