/**
 * Service booking. A booking is paid through the normal order pipeline (one order, one vendor
 * sub-order, one SERVICE line) so commission, ledger and refunds work exactly as for products.
 */
import { randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { priceOrder } from "@/server/domain/pricing";
import { loadCommissionRules, categoryAncestors, CartError } from "./cart";
import { nextOrderNumber } from "./orders";
import { getProvider } from "@/server/payments";
import { notify } from "./notify";
import type { BookingStatus } from "@prisma/client";

const TZ_OFFSET_MIN = 60; // Africa/Lagos is UTC+1 year-round (no DST)
const ACTIVE: BookingStatus[] = ["PENDING_PAYMENT", "REQUESTED", "CONFIRMED", "RESCHEDULED"];

/** Convert a Lagos local date (YYYY-MM-DD) + minutes-from-midnight to a UTC Date. */
export function lagosToUtc(date: string, minute: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minute - TZ_OFFSET_MIN));
}

export function lagosWeekday(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Free start times for a date, honouring weekly hours, existing bookings and a 2-hour lead time. */
export async function availableSlots(serviceId: string, packageId: string, date: string, now = new Date()) {
  const pkg = await db.servicePackage.findFirst({ where: { id: packageId, serviceId } });
  if (!pkg) return [];
  const hours = await db.serviceAvailability.findMany({ where: { serviceId, weekday: lagosWeekday(date) } });
  const dayStart = lagosToUtc(date, 0);
  const dayEnd = lagosToUtc(date, 24 * 60);
  const taken = await db.booking.findMany({ where: { serviceId, status: { in: ACTIVE }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } }, select: { startAt: true, endAt: true } });
  const step = 30;
  const out: { minute: number; label: string; iso: string }[] = [];
  for (const h of hours) {
    for (let m = h.startMinute; m + pkg.durationMinutes <= h.endMinute; m += step) {
      const start = lagosToUtc(date, m);
      const end = new Date(start.getTime() + pkg.durationMinutes * 60_000);
      if (start.getTime() < now.getTime() + 2 * 3600_000) continue;
      if (taken.some((t) => t.startAt < end && t.endAt > start)) continue;
      out.push({ minute: m, iso: start.toISOString(), label: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` });
    }
  }
  return out;
}

export async function createBooking(input: { customerId: string; email: string; serviceId: string; packageId: string; date: string; minute: number; notes?: string; address?: string }) {
  const service = await db.service.findFirst({
    where: { id: input.serviceId, status: "PUBLISHED", deletedAt: null, vendor: { status: "APPROVED" } },
    include: { packages: true, vendor: { include: { subscription: { include: { plan: true } } } } },
  });
  if (!service) throw new CartError("This service is no longer available.");
  const pkg = service.packages.find((p) => p.id === input.packageId);
  if (!pkg) throw new CartError("Choose a package.");
  const slots = await availableSlots(service.id, pkg.id, input.date);
  if (!slots.some((s) => s.minute === input.minute)) throw new CartError("That time is no longer available. Please pick another.");
  const startAt = lagosToUtc(input.date, input.minute);
  const endAt = new Date(startAt.getTime() + pkg.durationMinutes * 60_000);

  const pricing = priceOrder({
    lines: [{ key: "svc", vendorId: service.vendorId, productId: service.id, categoryId: service.categoryId, categoryAncestors: await categoryAncestors(db, service.categoryId), kind: "SERVICE", unitPriceMinor: pkg.priceMinor, quantity: 1 }],
    rules: await loadCommissionRules(db),
    shippingByVendor: {},
    vendorPlans: { [service.vendorId]: service.vendor.subscription?.status === "ACTIVE" ? service.vendor.subscription.plan.key : null },
  });
  const v = pricing.vendors[0];
  const provider = getProvider();

  const created = await db.$transaction(async (tx) => {
    // Serialise bookings per service so two customers cannot take the same slot.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"booking:" + service.id}))`;
    const clash = await tx.booking.findFirst({ where: { serviceId: service.id, status: { in: ACTIVE }, startAt: { lt: endAt }, endAt: { gt: startAt } } });
    if (clash) throw new CartError("That time was just booked by someone else. Please pick another.");
    const number = await nextOrderNumber(tx);
    const order = await tx.order.create({ data: { number, userId: input.customerId, subtotalMinor: pricing.subtotalMinor, totalMinor: pricing.totalMinor, taxMinor: pricing.taxMinor } });
    const vo = await tx.vendorOrder.create({
      data: { number: `${number}-A`, orderId: order.id, vendorId: service.vendorId, subtotalMinor: v.subtotalMinor, taxMinor: v.taxMinor, totalMinor: v.totalMinor, commissionMinor: v.commissionMinor, vendorNetMinor: v.vendorNetMinor },
    });
    const item = await tx.orderItem.create({
      data: { orderId: order.id, vendorOrderId: vo.id, kind: "SERVICE", name: `${service.title} — ${pkg.name}`, unitPriceMinor: pkg.priceMinor, quantity: 1, lineTotalMinor: pkg.priceMinor, commissionMinor: v.commissionMinor, commissionRuleId: v.lines[0].commissionRuleId },
    });
    const [bn] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('booking_number_seq') AS n`;
    const booking = await tx.booking.create({
      data: { number: `B-${bn.n}`, serviceId: service.id, packageId: pkg.id, vendorId: service.vendorId, customerId: input.customerId, orderItemId: item.id, startAt, endAt, notes: input.notes, address: input.address },
    });
    const payment = await tx.payment.create({ data: { orderId: order.id, provider: provider.name, reference: `${number}-${randomBytes(4).toString("hex")}`, amountMinor: order.totalMinor } });
    return { order, booking, payment };
  });

  const { authorizationUrl } = await provider.initialize({
    reference: created.payment.reference,
    amountMinor: created.payment.amountMinor,
    currency: "NGN",
    email: input.email,
    callbackUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/checkout/callback?reference=${encodeURIComponent(created.payment.reference)}`,
  });
  return { ...created, authorizationUrl };
}

/** Provider actions. vendorId is the tenant boundary. */
export async function setBookingStatus(vendorId: string, bookingId: string, next: "CONFIRMED" | "COMPLETED" | "CANCELLED", actorId: string, reason?: string) {
  const b = await db.booking.findFirst({ where: { id: bookingId, vendorId }, include: { service: true, orderItem: true } });
  if (!b) throw new CartError("Booking not found.");
  const allowed: Record<string, string[]> = { REQUESTED: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["COMPLETED", "CANCELLED"], RESCHEDULED: ["CONFIRMED", "COMPLETED", "CANCELLED"] };
  if (!allowed[b.status]?.includes(next)) throw new CartError(`A ${b.status.toLowerCase()} booking cannot be marked ${next.toLowerCase()}.`);
  await db.booking.update({ where: { id: b.id }, data: { status: next, completedAt: next === "COMPLETED" ? new Date() : undefined, cancelledAt: next === "CANCELLED" ? new Date() : undefined, cancelReason: reason } });
  if (b.orderItem) {
    if (next === "COMPLETED") {
      // Completion counts as delivery: the settlement hold window starts now.
      await db.vendorOrder.update({ where: { id: b.orderItem.vendorOrderId }, data: { status: "DELIVERED", deliveredAt: new Date() } });
      await db.vendorOrderEvent.create({ data: { vendorOrderId: b.orderItem.vendorOrderId, status: "DELIVERED", note: "Service completed", actorId } });
    }
    if (next === "CANCELLED") {
      const { refundVendorOrder } = await import("./finance");
      const vo = await db.vendorOrder.findUniqueOrThrow({ where: { id: b.orderItem.vendorOrderId } });
      if (vo.status !== "AWAITING_PAYMENT" && vo.status !== "REFUNDED") await refundVendorOrder(vo.id, actorId, reason ?? "Booking cancelled by provider");
    }
  }
  await notify(db, {
    userId: b.customerId,
    type: "booking.update",
    title: next === "CONFIRMED" ? `Booking ${b.number} confirmed` : next === "COMPLETED" ? `Booking ${b.number} completed` : `Booking ${b.number} cancelled`,
    body: next === "CANCELLED" ? `The provider cancelled this booking${reason ? `: ${reason}` : ""}. Your payment is being refunded.` : `${b.service.title} on ${b.startAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}.`,
    link: "/account/bookings",
  });
}
