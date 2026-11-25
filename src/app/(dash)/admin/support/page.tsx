import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import type { TicketStatus } from "@prisma/client";

export const metadata = { title: "Support" };

export default async function SupportQueue({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await guard("support.view");
  const sp = await searchParams;
  const statuses: TicketStatus[] = sp.status === "closed" ? ["RESOLVED", "CLOSED"] : ["OPEN", "ESCALATED", "PENDING_CUSTOMER"];
  const tickets = await db.supportTicket.findMany({ where: { status: { in: statuses } }, orderBy: [{ priority: "desc" }, { updatedAt: "asc" }], take: 200, include: { user: { select: { name: true, email: true } }, assignedTo: { select: { name: true } } } });
  return (
    <>
      <PageHeader title="Support" actions={<Link href={sp.status === "closed" ? "/admin/support" : "/admin/support?status=closed"} className="text-sm text-brand">{sp.status === "closed" ? "Show open" : "Show resolved"}</Link>} />
      <Table>
        <thead><tr><Th>Ticket</Th><Th>Customer</Th><Th>Topic</Th><Th>Priority</Th><Th>Assignee</Th><Th>Updated</Th><Th>Status</Th></tr></thead>
        <tbody>
          {tickets.length === 0 && <tr><Td colSpan={7} className="py-8 text-center text-ink-muted">No tickets.</Td></tr>}
          {tickets.map((t) => (
            <tr key={t.id} className="hover:bg-canvas">
              <Td><Link href={`/admin/support/${t.number}`} className="font-medium text-ink hover:text-brand">{t.number}</Link><span className="block max-w-64 truncate text-[12px] text-ink-muted">{t.subject}</span></Td>
              <Td>{t.user.name}<span className="block text-[12px] text-ink-muted">{t.user.email}</span></Td>
              <Td>{t.category}{t.orderNumber && <span className="block text-[12px] text-ink-muted">{t.orderNumber}</span>}</Td>
              <Td>{t.priority === "HIGH" || t.priority === "URGENT" ? <Badge tone="danger">{t.priority.toLowerCase()}</Badge> : t.priority.toLowerCase()}</Td>
              <Td>{t.assignedTo?.name ?? "—"}</Td><Td>{t.updatedAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</Td><Td><StatusBadge status={t.status} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
