import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { staffTicketReplyAction } from "@/app/actions/admin";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Checkbox, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

export default async function TicketAdmin({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const me = await guard("support.view");
  const { number } = await params;
  const sp = await searchParams;
  const t = await db.supportTicket.findUnique({ where: { number }, include: { user: true, assignedTo: true, messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, id: true } } } } } });
  if (!t) notFound();
  return (
    <>
      <PageHeader eyebrow={`${t.number} · ${t.category} · ${t.priority.toLowerCase()} priority`} title={t.subject} description={<span className="flex items-center gap-2"><StatusBadge status={t.status} /> {t.user.name} · {t.user.email} {t.orderNumber && <Link href={`/admin/orders/${t.orderNumber}`} className="text-brand underline">{t.orderNumber}</Link>}</span>} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <ol className="max-w-3xl space-y-3">
        {t.messages.map((m) => (
          <li key={m.id} className={`rounded-lg border p-4 text-sm ${m.internal ? "border-amber-200 bg-warning-soft" : m.author.id === t.userId ? "border-line bg-white" : "border-blue-200 bg-brand-soft/40"}`}>
            <p className="mb-1 text-[12px] text-ink-muted">{m.author.name}{m.internal && " · internal note"} · {m.createdAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</p>
            <p className="whitespace-pre-line leading-6">{m.body}</p>
          </li>
        ))}
      </ol>
      {me.permissions.has("support.respond") && (
        <form action={staffTicketReplyAction} className="mt-6 max-w-3xl space-y-3 rounded-lg border border-line bg-white p-4">
          <input type="hidden" name="number" value={t.number} />
          <Textarea name="body" rows={5} placeholder="Write a reply…" aria-label="Reply" />
          <div className="flex flex-wrap items-center gap-4">
            <Checkbox name="internal" label="Internal note (customer won't see it)" />
            <Select name="status" defaultValue={t.status === "OPEN" ? "PENDING_CUSTOMER" : t.status} className="h-9 w-56" aria-label="Status after reply">
              <option value="OPEN">Open</option><option value="PENDING_CUSTOMER">Waiting on customer</option><option value="ESCALATED">Escalate</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option>
            </Select>
            <SubmitButton>Update ticket</SubmitButton>
          </div>
        </form>
      )}
    </>
  );
}
