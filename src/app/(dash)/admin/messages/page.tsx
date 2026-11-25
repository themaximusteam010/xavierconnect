import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { audit } from "@/server/services/audit";
import { FilterBar, qs } from "@/components/admin/filters";
import { Panel } from "@/components/admin/charts";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";

export const metadata = { title: "Messages" };

/** Read-only oversight of customer↔vendor conversations. Opening a thread is audit-logged. */
export default async function Messages({ searchParams }: { searchParams: Promise<{ q?: string; id?: string; page?: string }> }) {
  const u = await guard("support.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = sp.q ? { OR: [{ subject: { contains: sp.q, mode: "insensitive" as const } }, { vendor: { businessName: { contains: sp.q, mode: "insensitive" as const } } }, { customer: { email: { contains: sp.q, mode: "insensitive" as const } } }] } : {};
  const [rows, total, sel] = await Promise.all([
    db.conversation.findMany({ where, orderBy: { lastMessageAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { vendor: { select: { businessName: true } }, customer: { select: { name: true } }, _count: { select: { messages: true } } } }),
    db.conversation.count({ where }),
    sp.id ? db.conversation.findUnique({ where: { id: sp.id }, include: { messages: { orderBy: { createdAt: "asc" }, include: { sender: { select: { name: true } } } }, vendor: { select: { businessName: true, ownerId: true } }, customer: { select: { name: true } } } }) : null,
  ]);
  if (sel) await audit(db, { actorId: u.id, action: "conversation.view", entityType: "Conversation", entityId: sel.id });
  return (
    <>
      <PageHeader title="Messages" description="Customer–vendor conversations, for dispute and fraud investigation. Viewing a conversation is recorded in the audit log." />
      {total === 0 && !sp.q && <Alert className="mb-4">No conversations yet. Buyers can message sellers from a store or order page once messaging is used.</Alert>}
      {sel && (
        <Panel title={`${sel.subject} · ${sel.customer.name} ↔ ${sel.vendor.businessName}`} className="mb-6" action={<Link href={qs("/admin/messages", { ...sp, id: undefined })} className="text-[12px] text-ink-muted">Close</Link>}>
          <ol className="space-y-2 text-[13px]">{sel.messages.map((m) => <li key={m.id} className={`max-w-[80%] rounded-md p-2.5 ${m.senderId === sel.vendor.ownerId ? "ml-auto bg-brand-soft/50" : "bg-canvas"}`}><p className="text-[11px] text-ink-muted">{m.sender.name} · {m.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</p><p className="whitespace-pre-line">{m.body}</p></li>)}</ol>
        </Panel>
      )}
      <FilterBar action="/admin/messages" values={sp} fields={[{ type: "search", name: "q", placeholder: "Subject, vendor or customer email" }]} />
      <Table>
        <thead><tr><Th>Subject</Th><Th>Customer</Th><Th>Vendor</Th><Th className="text-right">Messages</Th><Th>Last message</Th></tr></thead>
        <tbody>{rows.map((c) => (
          <tr key={c.id} className="hover:bg-canvas">
            <Td><Link href={qs("/admin/messages", { ...sp, id: c.id })} className="font-medium text-ink hover:text-brand">{c.subject}</Link></Td>
            <Td>{c.customer.name}</Td><Td>{c.vendor.businessName}</Td><Td className="tabular text-right">{c._count.messages}</Td>
            <Td>{c.lastMessageAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</Td>
          </tr>
        ))}</tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(n) => qs("/admin/messages", { ...sp, page: n })} />
    </>
  );
}
