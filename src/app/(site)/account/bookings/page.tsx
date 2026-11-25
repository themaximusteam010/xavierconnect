import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, StatusBadge } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "Bookings" };

export default async function Bookings() {
  const u = await requireUser("/account/bookings");
  const list = await db.booking.findMany({ where: { customerId: u.id }, orderBy: { startAt: "desc" }, include: { service: true, package: true, vendor: { include: { store: true } }, orderItem: { include: { order: true } } } });
  return (
    <>
      <PageHeader title="Bookings" />
      {list.length === 0 ? <EmptyState icon={CalendarDays} title="No bookings yet" action={<ButtonLink href="/services" variant="secondary">Find a service</ButtonLink>} /> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {list.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm">
              <div>
                <Link href={`/services/${b.service.slug}`} className="font-medium hover:text-brand">{b.service.title}</Link>
                <p className="text-ink-muted">{b.package.name} · {b.vendor.store?.name}</p>
                <p className="tabular text-ink-2">{b.startAt.toLocaleString("en-NG", { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Lagos" })}</p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={b.status} />
                {b.orderItem && <Link href={`/account/orders/${b.orderItem.order.number}`} className="text-[13px] text-brand hover:underline">{b.status === "PENDING_PAYMENT" ? "Pay now" : "View order"}</Link>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
