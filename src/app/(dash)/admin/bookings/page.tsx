import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { FilterBar, qs } from "@/components/admin/filters";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { formatMoney } from "@/lib/money";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Bookings" };

export default async function Bookings({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; when?: string; page?: string }> }) {
  await guard("order.view_all");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const now = new Date();
  const where: Prisma.BookingWhereInput = {
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(sp.when === "upcoming" ? { startAt: { gte: now } } : sp.when === "past" ? { startAt: { lt: now } } : {}),
    ...(sp.q ? { OR: [{ number: { contains: sp.q.toUpperCase() } }, { vendor: { businessName: { contains: sp.q, mode: "insensitive" } } }, { customer: { email: { contains: sp.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.booking.findMany({ where, orderBy: { startAt: sp.when === "upcoming" ? "asc" : "desc" }, skip: (page - 1) * 50, take: 50, include: { service: { select: { title: true } }, package: { select: { name: true, priceMinor: true } }, vendor: { select: { businessName: true } }, customer: { select: { name: true, email: true } } } }),
    db.booking.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Bookings" description="Service earnings settle only after the provider marks the booking completed and the hold period passes." />
      <FilterBar action="/admin/bookings" values={sp} fields={[
        { type: "search", name: "q", placeholder: "Booking no., vendor or customer email" },
        { type: "select", name: "status", label: "Status", options: [["PENDING_PAYMENT", "Awaiting payment"], ["REQUESTED", "Requested"], ["CONFIRMED", "Confirmed"], ["RESCHEDULED", "Rescheduled"], ["COMPLETED", "Completed"], ["CANCELLED", "Cancelled"]] },
        { type: "select", name: "when", label: "When", options: [["upcoming", "Upcoming"], ["past", "Past"]] },
      ]} />
      <Table>
        <thead><tr><Th>Booking</Th><Th>Service</Th><Th>Provider</Th><Th>Customer</Th><Th>Scheduled</Th><Th className="text-right">Price</Th><Th>Status</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={7} className="py-8 text-center text-ink-muted">No bookings match.</Td></tr>}
          {rows.map((b) => (
            <tr key={b.id}>
              <Td className="font-mono text-[12px]">{b.number}</Td>
              <Td>{b.service.title}<span className="block text-[11px] text-ink-muted">{b.package.name}</span></Td>
              <Td>{b.vendor.businessName}</Td>
              <Td>{b.customer.name}<span className="block text-[11px] text-ink-muted">{b.customer.email}</span></Td>
              <Td className="whitespace-nowrap">{b.startAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}</Td>
              <Td className="tabular text-right">{formatMoney(b.package.priceMinor)}</Td>
              <Td><StatusBadge status={b.status} />{b.cancelReason && <span className="block text-[11px] text-ink-muted">{b.cancelReason}</span>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(n) => qs("/admin/bookings", { ...sp, page: n })} />
    </>
  );
}
