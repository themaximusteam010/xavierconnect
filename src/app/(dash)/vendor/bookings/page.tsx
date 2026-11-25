import { CalendarDays } from "lucide-react";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { bookingStatusAction } from "@/app/actions/vendor";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Bookings" };

export default async function VendorBookings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { vendorId } = await requireVendor("services");
  const sp = await searchParams;
  const list = await db.booking.findMany({ where: { vendorId, status: { not: "PENDING_PAYMENT" } }, orderBy: { startAt: "asc" }, include: { service: true, package: true, customer: { select: { name: true } } } });
  const upcoming = list.filter((b) => ["REQUESTED", "CONFIRMED", "RESCHEDULED"].includes(b.status));
  const past = list.filter((b) => !upcoming.includes(b));
  const Row = ({ b }: { b: (typeof list)[number] }) => (
    <li className="flex flex-wrap items-start justify-between gap-4 px-4 py-4 text-sm">
      <div>
        <p className="tabular font-medium">{b.startAt.toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}</p>
        <p>{b.service.title} · {b.package.name}</p>
        <p className="text-ink-muted">{b.customer.name} · {b.number} · {formatMoney(b.package.priceMinor)}</p>
        {b.address && <p className="text-ink-muted">At: {b.address}</p>}
        {b.notes && <p className="mt-1 max-w-lg text-ink-2">“{b.notes}”</p>}
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge status={b.status} />
        {b.status === "REQUESTED" && <form action={bookingStatusAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="next" value="CONFIRMED" /><SubmitButton size="sm">Confirm</SubmitButton></form>}
        {["CONFIRMED", "RESCHEDULED"].includes(b.status) && <form action={bookingStatusAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="next" value="COMPLETED" /><SubmitButton size="sm">Mark completed</SubmitButton></form>}
        {["REQUESTED", "CONFIRMED", "RESCHEDULED"].includes(b.status) && <form action={bookingStatusAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="next" value="CANCELLED" /><input type="hidden" name="reason" value="Provider unavailable" /><SubmitButton size="sm" variant="ghost" confirm="Cancel this booking and refund the customer?">Cancel</SubmitButton></form>}
      </div>
    </li>
  );
  return (
    <>
      <PageHeader title="Bookings" description="Times are shown in Lagos time (WAT)." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      {list.length === 0 ? <EmptyState icon={CalendarDays} title="No bookings yet">Paid bookings appear here for you to confirm.</EmptyState> : (
        <div className="space-y-8">
          <section><h2 className="mb-3 font-semibold">Upcoming</h2>{upcoming.length ? <ul className="divide-y divide-line rounded-lg border border-line bg-white">{upcoming.map((b) => <Row key={b.id} b={b} />)}</ul> : <p className="text-sm text-ink-muted">Nothing upcoming.</p>}</section>
          {past.length > 0 && <section><h2 className="mb-3 font-semibold">Past and cancelled</h2><ul className="divide-y divide-line rounded-lg border border-line bg-white">{past.map((b) => <Row key={b.id} b={b} />)}</ul></section>}
        </div>
      )}
    </>
  );
}
