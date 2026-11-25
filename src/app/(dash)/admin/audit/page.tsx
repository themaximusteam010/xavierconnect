import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { Input } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";

export const metadata = { title: "Audit log" };

export default async function Audit({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await guard("audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = sp.q ? { OR: [{ action: { contains: sp.q } }, { entityId: sp.q }, { entityType: { contains: sp.q, mode: "insensitive" as const } }, { actor: { email: { contains: sp.q, mode: "insensitive" as const } } }] } : {};
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 100, take: 100, include: { actor: { select: { name: true, email: true } } } }),
    db.auditLog.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Audit log" description="Sensitive actions: approvals, money movements, role and status changes, document access." actions={<form><Input name="q" defaultValue={sp.q} placeholder="Action, entity id or actor email" className="h-9 w-72" /></form>} />
      <Table>
        <thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>Details</Th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <Td className="tabular whitespace-nowrap">{r.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "medium" })}</Td>
            <Td>{r.actor ? `${r.actor.name}` : "system"}{r.ipAddress && <span className="block text-[11px] text-ink-muted">{r.ipAddress}</span>}</Td>
            <Td className="font-mono text-[12px]">{r.action}</Td>
            <Td>{r.entityType}<span className="block font-mono text-[11px] text-ink-muted">{r.entityId}</span></Td>
            <Td className="max-w-md"><code className="line-clamp-3 break-all text-[11px] text-ink-muted">{r.after ? JSON.stringify(r.after) : ""}</code></Td>
          </tr>
        ))}</tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / 100)} href={(p) => `/admin/audit?page=${p}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`} />
    </>
  );
}
