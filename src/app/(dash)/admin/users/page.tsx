import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { ROLES } from "@/server/auth/rbac";

export const metadata = { title: "Users" };

export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; page?: string }> }) {
  await guard("user.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = {
    deletedAt: null,
    ...(sp.q ? { OR: [{ email: { contains: sp.q, mode: "insensitive" as const } }, { name: { contains: sp.q, mode: "insensitive" as const } }] } : {}),
    ...(sp.role ? { roles: { some: { role: { key: sp.role } } } } : {}),
  };
  const [users, total] = await Promise.all([
    db.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { roles: { include: { role: true } } } }),
    db.user.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Users & staff" description={`${total.toLocaleString()} accounts`} />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Name or email" className="h-9 w-64" />
        <Select name="role" defaultValue={sp.role ?? ""} className="h-9 w-56"><option value="">All roles</option>{Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.name}</option>)}</Select>
        <Button type="submit" variant="secondary" size="sm" className="h-9">Filter</Button>
      </form>
      <Table>
        <thead><tr><Th>User</Th><Th>Roles</Th><Th>Joined</Th><Th>Last sign-in</Th><Th>Status</Th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id} className="hover:bg-canvas">
            <Td><Link href={`/admin/users/${u.id}`} className="font-medium text-ink hover:text-brand">{u.name}</Link><span className="block text-[12px] text-ink-muted">{u.email}{!u.emailVerifiedAt && " · unverified"}</span></Td>
            <Td>{[...new Set(u.roles.map((r) => r.role.name))].join(", ")}</Td>
            <Td>{u.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td>
            <Td>{u.lastLoginAt?.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) ?? "—"}</Td>
            <Td><StatusBadge status={u.status} /></Td>
          </tr>
        ))}</tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(p) => `/admin/users?page=${p}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}${sp.role ? `&role=${sp.role}` : ""}`} />
    </>
  );
}
