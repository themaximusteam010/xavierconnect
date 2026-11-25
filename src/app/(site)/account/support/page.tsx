import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/feedback";
import { TicketForm } from "@/components/account-forms";

export const metadata = { title: "Support" };

export default async function Support({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const u = await requireUser("/account/support");
  const { order } = await searchParams;
  const tickets = await db.supportTicket.findMany({ where: { userId: u.id }, orderBy: { updatedAt: "desc" } });
  return (
    <>
      <PageHeader title="Support" description="Our team replies by email and here, usually within one business day." />
      {tickets.length > 0 && (
        <ul className="mb-10 divide-y divide-line rounded-lg border border-line">
          {tickets.map((t) => (
            <li key={t.id}><Link href={`/account/support/${t.number}`} className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-canvas">
              <span><span className="font-medium">{t.number}</span> <span className="text-ink-2">· {t.subject}</span></span><StatusBadge status={t.status} />
            </Link></li>
          ))}
        </ul>
      )}
      <h2 className="mb-4 font-semibold">Open a new ticket</h2>
      <TicketForm order={order} />
    </>
  );
}
