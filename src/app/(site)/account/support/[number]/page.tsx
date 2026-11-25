import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { replyTicketAction } from "@/app/actions/account";
import { StatusBadge } from "@/components/ui/feedback";
import { Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

export default async function Ticket({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const u = await requireUser(`/account/support/${number}`);
  const t = await db.supportTicket.findFirst({ where: { number, userId: u.id }, include: { messages: { where: { internal: false }, orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, id: true } } } } } });
  if (!t) notFound();
  return (
    <>
      <div className="mb-6"><div className="flex items-center gap-3"><h1 className="text-xl font-semibold">{t.subject}</h1><StatusBadge status={t.status} /></div><p className="mt-1 text-sm text-ink-muted">{t.number} · {t.category}{t.orderNumber ? ` · ${t.orderNumber}` : ""}</p></div>
      <ol className="space-y-4">
        {t.messages.map((m) => (
          <li key={m.id} className={`rounded-lg border p-4 text-sm ${m.author.id === u.id ? "border-line" : "border-blue-200 bg-brand-soft/40"}`}>
            <p className="mb-1 text-[12px] text-ink-muted">{m.author.id === u.id ? "You" : `${m.author.name} · XavierConnect Support`} · {m.createdAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</p>
            <p className="whitespace-pre-line leading-6">{m.body}</p>
          </li>
        ))}
      </ol>
      {t.status !== "CLOSED" && (
        <form action={replyTicketAction} className="mt-6 space-y-3">
          <input type="hidden" name="number" value={t.number} />
          <label htmlFor="body" className="text-sm font-medium">Add a reply</label>
          <Textarea id="body" name="body" rows={4} required minLength={2} />
          <SubmitButton>Send reply</SubmitButton>
        </form>
      )}
    </>
  );
}
