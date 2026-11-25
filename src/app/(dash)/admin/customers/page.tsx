import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { FilterBar, qs } from "@/components/admin/filters";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Customers" };

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; verified?: string; page?: string }> }) {
  await guard("user.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = {
    deletedAt: null,
    roles: { some: { role: { key: "CUSTOMER" } } },
    ...(sp.q ? { OR: [{ email: { contains: sp.q, mode: "insensitive" as const } }, { name: { contains: sp.q, mode: "insensitive" as const } }] } : {}),
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(sp.verified ? { emailVerifiedAt: sp.verified === "1" ? { not: null } : null } : {}),
  };
  const [users, total] = await Promise.all([db.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }), db.user.count({ where })]);
  const stats = users.length ? await db.order.groupBy({ by: ["userId"], where: { userId: { in: users.map((u) => u.id) }, paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, _count: true, _sum: { totalMinor: true } }) : [];
  return (
    <>
      <PageHeader title="Customers" description={`${total.toLocaleString()} customer accounts`} />
      <FilterBar action="/admin/customers" values={sp} fields={[
        { type: "search", name: "q", placeholder: "Name or email" },
        { type: "select", name: "status", label: "Status", options: [["ACTIVE", "Active"], ["SUSPENDED", "Suspended"]] },
        { type: "select", name: "verified", label: "Email", options: [["1", "Verified"], ["0", "Unverified"]] },
      ]} />
      <Table>
        <thead><tr><Th>Customer</Th><Th>Joined</Th><Th>Last sign-in</Th><Th className="text-right">Paid orders</Th><Th className="text-right">Spent</Th><Th>Status</Th></tr></thead>
        <tbody>{users.map((u) => { const s = stats.find((x) => x.userId === u.id); return (
          <tr key={u.id} className="hover:bg-canvas">
            <Td><Link href={`/admin/users/${u.id}`} className="font-medium text-ink hover:text-brand">{u.name}</Link><span className="block text-[12px] text-ink-muted">{u.email}{!u.emailVerifiedAt && " · unverified"}</span></Td>
            <Td>{u.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td>
            <Td>{u.lastLoginAt?.toLocaleDateString("en-NG", { dateStyle: "medium" }) ?? "—"}</Td>
            <Td className="tabular text-right">{s?._count ?? 0}</Td>
            <Td className="tabular text-right">{formatMoney(s?._sum.totalMinor ?? 0n)}</Td>
            <Td><StatusBadge status={u.status} /></Td>
          </tr>
        ); })}</tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(n) => qs("/admin/customers", { ...sp, page: n })} />
    </>
  );
}
