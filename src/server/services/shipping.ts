/**
 * Shipment booking, cancellation, tracking and pickup for vendor sub-orders (ShippingBookingService +
 * ShippingTrackingService). Each vendor sub-order ships independently; products from different vendors are never
 * combined. A carrier "delivered" event becomes CARRIER delivery evidence for that sub-order only.
 *
 * Integrity rules:
 *  - One booking per sub-order + quote: a Shipment row with a unique idempotencyKey is reserved BEFORE calling the
 *    carrier, so double-clicks or retries can't buy two labels.
 *  - Only verified provider data changes a status: webhooks must pass the adapter's signature check, polled tracking
 *    only applies statuses the adapter could map from documented codes.
 *  - Prices come from the provider's response, never from formulas (the sandbox simulator is refused in production).
 */
import { createHash } from "node:crypto";
import { Prisma, type ShipmentStatus } from "@prisma/client";
import { db } from "@/server/db";
import { requireShipping, shippingAdapter, providerContext } from "@/server/integrations/registry";
import { ProviderUnavailableError, type Rate, type TrackingUpdate } from "@/server/integrations/types";
import { audit } from "./audit";
import { notify } from "./notify";
import { recomputeOrderStatus } from "./orders";
import { raiseAlert } from "./monitoring";

export class ShippingError extends Error {}

export interface CustomsInput {
  contents: string;
  declaredValueMinor: bigint;
  currency: string;
  hsCodes: string[];
  incoterm: "DAP" | "DDP";
  insured: boolean;
}

export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  PENDING: "Pending", AWAITING_PICKUP: "Awaiting pickup", PICKED_UP: "Picked up", IN_TRANSIT: "In transit",
  AT_SORTING_FACILITY: "At sorting facility", CUSTOMS_PROCESSING: "Customs processing", OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered", FAILED_ATTEMPT: "Delivery failed", RETURNED: "Returned to sender", CANCELLED: "Cancelled",
};
const ORDER: ShipmentStatus[] = ["PENDING", "AWAITING_PICKUP", "PICKED_UP", "IN_TRANSIT", "AT_SORTING_FACILITY", "CUSTOMS_PROCESSING", "OUT_FOR_DELIVERY", "DELIVERED"];
const EXCEPTIONS: ShipmentStatus[] = ["FAILED_ATTEMPT", "RETURNED", "CANCELLED"];
export const ACTIVE_STATUSES: ShipmentStatus[] = ["PENDING", "AWAITING_PICKUP", "PICKED_UP", "IN_TRANSIT", "AT_SORTING_FACILITY", "CUSTOMS_PROCESSING", "OUT_FOR_DELIVERY", "FAILED_ATTEMPT"];

async function vendorOrderForShipping(vendorId: string, vendorOrderId: string) {
  const vo = await db.vendorOrder.findFirst({
    where: { id: vendorOrderId, vendorId },
    include: { items: { include: { product: true } }, order: true, vendor: true, shipments: true },
  });
  if (!vo) throw new ShippingError("Order not found.");
  if (!["PROCESSING", "READY_FOR_DISPATCH"].includes(vo.status)) throw new ShippingError("Accept the order and prepare it before buying a label.");
  if (vo.items.every((i) => i.kind !== "PHYSICAL")) throw new ShippingError("This order has nothing to ship.");
  return vo;
}

type Dest = { fullName: string; phone: string; line1: string; city: string; state: string; country?: string; postalCode?: string };

// ─── Rates for the vendor booking screen ─────────────────────────────────────

export async function getShippingQuotes(vendorId: string, vendorOrderId: string, providerKey: string, pickupAddressId: string, dims: { length: number; width: number; height: number }) {
  const vo = await vendorOrderForShipping(vendorId, vendorOrderId);
  const pickup = await db.pickupAddress.findFirst({ where: { id: pickupAddressId, vendorId } });
  if (!pickup) throw new ShippingError("Choose a pickup address.");
  const to = vo.order.shippingAddress as Dest | null;
  if (!to) throw new ShippingError("This order has no delivery address.");
  let adapterCtx;
  try { adapterCtx = await requireShipping(providerKey, "RATE_QUOTE"); } catch (e) { throw new ShippingError((e as Error).message); }
  const { adapter, ctx } = adapterCtx;
  const route = `${pickup.country}>${to.country ?? "NG"}`;
  if (!adapter.routes.includes(route)) throw new ShippingError(`${adapter.name} does not serve ${route.replace(">", " → ")}.`);
  const physical = vo.items.filter((i) => i.kind === "PHYSICAL");
  const grams = physical.reduce((a, i) => a + (i.product?.weightGrams ?? 0) * i.quantity, 0);
  const provider = await db.integrationProvider.findUnique({ where: { key: providerKey } });
  if (provider?.maxWeightGrams && grams > provider.maxWeightGrams) throw new ShippingError(`${adapter.name} accepts parcels up to ${provider.maxWeightGrams / 1000} kg.`);
  const customer = vo.order.userId ? await db.user.findUnique({ where: { id: vo.order.userId }, select: { email: true } }) : null;
  const codes = (pickup.providerAddressCodes ?? {}) as Record<string, string | number>;
  let result;
  try {
    result = await adapter.getRates!(ctx, {
      origin: { name: pickup.contactName, phone: pickup.phone, email: pickup.email, line1: pickup.line1, city: pickup.city, region: pickup.region, country: pickup.country, postalCode: pickup.postalCode, providerCode: codes[providerKey] ?? null },
      destination: { name: to.fullName, phone: to.phone, email: customer?.email ?? vo.order.guestEmail ?? "", line1: to.line1, city: to.city, region: to.state, country: to.country ?? "NG", postalCode: to.postalCode },
      items: physical.map((i) => ({ name: i.name, description: i.name, unitValueMinor: i.unitPriceMinor, quantity: i.quantity, weightGrams: i.product?.weightGrams ?? 0 })),
      dimensionsCm: dims,
      pickupDate: new Date(Date.now() + vo.vendor.handlingDays * 864e5).toISOString().slice(0, 10),
      currency: "NGN",
    });
  } catch (e) {
    throw new ShippingError(`${adapter.name} could not quote: ${(e as Error).message}`);
  }
  if (!result.rates.length) throw new ShippingError(`${adapter.name} returned no rates for this parcel and route.`);
  // Replace earlier booking-screen quotes, but keep the courier quote the customer paid for at checkout.
  await db.shippingQuote.deleteMany({ where: { vendorOrderId, providerKey, cartId: null, ...(vo.shippingQuoteId ? { id: { not: vo.shippingQuoteId } } : {}) } });
  const rows = [];
  for (const r of result.rates) {
    // Short-lived quote for this booking screen only. Providers whose terms forbid storing rates get the shortest window.
    const ttl = Math.min(30 * 60_000, r.validForMs && r.validForMs > 0 ? r.validForMs : 15 * 60_000);
    rows.push(await db.shippingQuote.create({ data: { providerKey, vendorId, vendorOrderId, providerRequestRef: result.requestRef, courierId: r.courierId, serviceCode: r.serviceCode, courierName: r.courierName, amountMinor: r.amountMinor, costMinor: r.amountMinor, currency: r.currency, etaText: r.etaText, etaDaysMin: r.etaDaysMin, etaDaysMax: r.etaDaysMax, methodType: r.methodType, trackingAvailable: r.trackingAvailable ?? true, restrictions: r.restrictions, expiresAt: new Date(Date.now() + ttl) } }));
  }
  return { rows, international: pickup.country !== (to.country ?? "NG"), origin: pickup.country, destination: to.country ?? "NG" };
}

// ─── Booking ─────────────────────────────────────────────────────────────────

export async function buyLabel(vendorId: string, quoteId: string, actorId: string, customs?: CustomsInput) {
  const q = await db.shippingQuote.findFirst({ where: { id: quoteId, vendorId } });
  if (!q || !q.vendorOrderId) throw new ShippingError("Quote not found.");
  if (q.expiresAt && q.expiresAt < new Date()) throw new ShippingError("This quote has expired. Get new quotes.");
  if (q.currency !== "NGN") throw new ShippingError(`This rate is in ${q.currency}. Only naira rates can be booked until an admin-approved currency rule exists.`);
  const vo = await vendorOrderForShipping(vendorId, q.vendorOrderId);
  if (vo.shipments.some((s) => s.providerKey && !["CANCELLED", "RETURNED"].includes(s.status))) throw new ShippingError("A carrier shipment already exists for this order.");
  const pickup = (await db.pickupAddress.findFirst({ where: { vendorId, isDefault: true } })) ?? (await db.pickupAddress.findFirst({ where: { vendorId } }));
  const dest = vo.order.shippingAddress as Dest | null;
  const destCountry = dest?.country ?? "NG";
  const international = (pickup?.country ?? vo.vendor.country) !== destCountry;
  if (international && !customs) throw new ShippingError("International shipments need a customs declaration.");
  if (customs && (!customs.contents.trim() || customs.declaredValueMinor <= 0n)) throw new ShippingError("Describe the contents and declare their value.");

  let adapterCtx;
  try { adapterCtx = await requireShipping(q.providerKey, "CREATE_SHIPMENT"); } catch (e) { throw new ShippingError((e as Error).message); }
  const { adapter, ctx } = adapterCtx;
  const physical = vo.items.filter((i) => i.kind === "PHYSICAL");
  const weight = physical.reduce((a, i) => a + (i.product?.weightGrams ?? 0) * i.quantity, 0);

  // 1. Reserve the booking (unique idempotency key) before any money is spent at the carrier.
  let reserved;
  try {
    reserved = await db.shipment.create({
      data: {
        vendorOrderId: vo.id, carrier: q.courierName, providerKey: q.providerKey, service: q.serviceCode, status: "PENDING", quoteId: q.id,
        idempotencyKey: `label:${vo.id}:${q.id}`, method: q.methodType ?? (international ? "EXPRESS" : "STANDARD"),
        costMinor: q.costMinor ?? q.amountMinor, costCurrency: q.currency, international, originCountry: pickup?.country ?? vo.vendor.country, destinationCountry: destCountry,
        weightGrams: weight || null, originAddress: pickup ? { name: pickup.contactName, phone: pickup.phone, line1: pickup.line1, city: pickup.city, region: pickup.region, country: pickup.country } : Prisma.JsonNull,
        destinationAddress: dest ? { ...dest, country: destCountry } : Prisma.JsonNull,
        estimatedDeliveryAt: q.etaDaysMax ? new Date(Date.now() + (vo.vendor.handlingDays + q.etaDaysMax) * 864e5) : null,
        items: { create: physical.map((i) => ({ orderItemId: i.id, quantity: i.quantity })) },
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ShippingError("This label is already being booked. Refresh the page.");
    throw e;
  }

  // 2. Book with the carrier.
  const rate: Rate = { courierId: q.courierId ?? "", serviceCode: q.serviceCode, courierName: q.courierName, amountMinor: q.amountMinor, currency: q.currency, etaText: q.etaText ?? undefined };
  let created;
  try {
    created = await adapter.createShipment!(ctx, { requestRef: q.providerRequestRef ?? "", rate, reference: vo.number, customs: customs ? { incoterm: customs.incoterm, insured: customs.insured } : undefined });
  } catch (e) {
    await db.shipment.update({ where: { id: reserved.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Booking failed", failureReason: (e as Error).message.slice(0, 300), idempotencyKey: null } });
    throw new ShippingError(`${adapter.name} could not create the shipment: ${(e as Error).message}`);
  }

  // 3. Record the result.
  const shipment = await db.$transaction(async (tx) => {
    const s = await tx.shipment.update({
      where: { id: reserved.id },
      data: { carrier: created.courierName ?? q.courierName, trackingNumber: created.trackingNumber ?? null, trackingUrl: created.trackingUrl ?? null, labelUrl: created.labelUrl ?? null, providerShipmentId: created.providerShipmentId, status: "AWAITING_PICKUP", lastEventAt: new Date() },
    });
    if (created.labelUrl) await tx.shipmentLabel.create({ data: { shipmentId: s.id, format: "URL", url: created.labelUrl } });
    await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: "AWAITING_PICKUP", note: `Booked with ${adapter.name} (${q.courierName})` } });
    if (customs) {
      await tx.customsDeclaration.create({
        data: {
          shipmentId: s.id, contents: customs.contents, declaredValueMinor: customs.declaredValueMinor, currency: customs.currency, originCountry: pickup?.country ?? vo.vendor.country,
          hsCodes: customs.hsCodes, incoterm: customs.incoterm, insured: customs.insured,
          items: physical.map((i) => ({ name: i.name, quantity: i.quantity, unitValueMinor: i.unitPriceMinor.toString() })),
        },
      });
    }
    await tx.vendorOrder.update({ where: { id: vo.id }, data: { status: "SHIPPED", shippingCostMinor: q.costMinor ?? q.amountMinor } });
    await tx.vendorOrderEvent.create({ data: { vendorOrderId: vo.id, status: "SHIPPED", note: `${adapter.name}: ${q.courierName}${created.trackingNumber ? `, tracking ${created.trackingNumber}` : ""}`, actorId } });
    await recomputeOrderStatus(tx, vo.orderId);
    await audit(tx, { actorId, action: "shipment.create", entityType: "Shipment", entityId: s.id, after: { provider: q.providerKey, international, costMinor: (q.costMinor ?? q.amountMinor).toString() } });
    return s;
  });
  if (vo.order.userId) {
    await notify(db, { userId: vo.order.userId, type: "order.shipped", title: `Part of ${vo.order.number} has shipped`, body: `${q.courierName}${created.trackingNumber ? ` · tracking ${created.trackingNumber}` : ""}.`, link: `/account/shipments` });
  }
  return shipment;
}

// ─── Cancellation ────────────────────────────────────────────────────────────

export async function cancelShipment(actor: { id: string; vendorId?: string; staff?: boolean }, shipmentId: string, reason: string) {
  const s = await db.shipment.findFirst({ where: { id: shipmentId, ...(actor.staff ? {} : { vendorOrder: { vendorId: actor.vendorId ?? "-" } }) }, include: { vendorOrder: { include: { order: true, shipments: true } } } });
  if (!s) throw new ShippingError("Shipment not found.");
  if (!["PENDING", "AWAITING_PICKUP"].includes(s.status)) throw new ShippingError("Only shipments that haven't been picked up can be cancelled.");
  if (reason.trim().length < 3) throw new ShippingError("Give a reason.");
  if (s.providerKey && s.providerShipmentId) {
    const adapter = shippingAdapter(s.providerKey);
    if (!adapter?.cancelShipment) throw new ShippingError(`${adapter?.name ?? s.providerKey} doesn't support cancelling through its API. Contact the carrier, then ask support to record it.`);
    const ctx = await providerContext(s.providerKey);
    let r;
    try { r = await adapter.cancelShipment(ctx, s.providerShipmentId); } catch (e) { throw new ShippingError(`${adapter.name} refused the cancellation: ${(e as Error).message}`); }
    if (!r.ok) throw new ShippingError(`${adapter.name}: ${r.message}`);
  }
  await db.$transaction(async (tx) => {
    await tx.shipment.update({ where: { id: s.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.trim(), idempotencyKey: null } });
    await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: "CANCELLED", note: reason.trim() } });
    const others = s.vendorOrder.shipments.filter((x) => x.id !== s.id && !["CANCELLED", "RETURNED"].includes(x.status));
    if (!others.length && s.vendorOrder.status === "SHIPPED") {
      await tx.vendorOrder.update({ where: { id: s.vendorOrderId }, data: { status: "PROCESSING" } });
      await tx.vendorOrderEvent.create({ data: { vendorOrderId: s.vendorOrderId, status: "PROCESSING", note: `Shipment cancelled: ${reason.trim()}`, actorId: actor.id } });
      await recomputeOrderStatus(tx, s.vendorOrder.orderId);
    }
    await audit(tx, { actorId: actor.id, action: "shipment.cancel", entityType: "Shipment", entityId: s.id, after: { reason } });
  });
}

// ─── Pickup ──────────────────────────────────────────────────────────────────

export async function schedulePickup(vendorId: string, shipmentId: string, date: string, actorId: string) {
  const s = await db.shipment.findFirst({ where: { id: shipmentId, vendorOrder: { vendorId } } });
  if (!s) throw new ShippingError("Shipment not found.");
  if (!["PENDING", "AWAITING_PICKUP"].includes(s.status)) throw new ShippingError("This shipment has already been collected.");
  const when = new Date(`${date}T09:00:00+01:00`);
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 864e5) throw new ShippingError("Choose a pickup date from today onwards.");
  let ref: string | null = null;
  const adapter = s.providerKey ? shippingAdapter(s.providerKey) : undefined;
  if (adapter?.schedulePickup && s.providerShipmentId) {
    const r = await adapter.schedulePickup(await providerContext(s.providerKey!), { providerShipmentId: s.providerShipmentId, date });
    ref = r.ref;
  }
  await db.shipment.update({ where: { id: s.id }, data: { pickupScheduledAt: when, pickupRef: ref, status: "AWAITING_PICKUP" } });
  await db.shipmentEvent.create({ data: { shipmentId: s.id, status: "AWAITING_PICKUP", note: ref ? `Pickup booked with ${adapter!.name} (${ref}) for ${date}` : `Seller arranged pickup for ${date}${adapter && !adapter.schedulePickup ? ` (${adapter.name} sets pickup when the label is booked)` : ""}` } });
  await audit(db, { actorId, action: "shipment.pickup", entityType: "Shipment", entityId: s.id, after: { date, ref } });
}

// ─── Tracking ────────────────────────────────────────────────────────────────

/** Applies a verified carrier event. Idempotent via ShipmentEvent.providerEventId. */
export async function applyTrackingUpdate(providerKey: string, u: TrackingUpdate) {
  const s = await db.shipment.findFirst({ where: { providerKey, providerShipmentId: u.providerShipmentId }, include: { vendorOrder: { include: { order: true } } } });
  if (!s) throw new Error(`Unknown ${providerKey} shipment ${u.providerShipmentId}`);
  const dup = await db.shipmentEvent.findUnique({ where: { providerEventId: `${providerKey}:${u.eventKey}` } });
  if (dup) return "noop";
  await db.$transaction(async (tx) => {
    await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: u.status, note: u.note, location: u.location, providerEventId: `${providerKey}:${u.eventKey}`, createdAt: u.occurredAt } });
    if (s.status === "CANCELLED" || s.status === "DELIVERED") {
      await tx.shipment.update({ where: { id: s.id }, data: { lastEventAt: u.occurredAt } });
      return; // terminal: record the event, never reopen
    }
    // Don't move backwards on out-of-order events (exceptions always apply).
    const forward = EXCEPTIONS.includes(u.status) || ORDER.indexOf(u.status) >= ORDER.indexOf(s.status);
    await tx.shipment.update({
      where: { id: s.id },
      data: {
        lastEventAt: u.occurredAt, ...(forward ? { status: u.status } : {}),
        ...(u.status === "DELIVERED" ? { deliveredAt: u.occurredAt } : {}),
        ...(u.status === "PICKED_UP" && !s.shippedAt ? { shippedAt: u.occurredAt } : {}),
        ...(u.status === "CANCELLED" ? { cancelledAt: u.occurredAt, cancelReason: u.note ?? "Cancelled by carrier" } : {}),
        ...(u.status === "FAILED_ATTEMPT" || u.status === "RETURNED" ? { failureReason: u.note ?? null } : {}),
      },
    });
    if (u.status === "DELIVERED" && s.leg !== "TO_WAREHOUSE" && ["SHIPPED", "DELIVERED"].includes(s.vendorOrder.status)) {
      await tx.vendorOrder.update({ where: { id: s.vendorOrderId }, data: { status: "DELIVERED", deliveredAt: s.vendorOrder.deliveredAt ?? u.occurredAt, deliveryEvidence: "CARRIER" } });
      await tx.vendorOrderEvent.create({ data: { vendorOrderId: s.vendorOrderId, status: "DELIVERED", note: `Carrier confirmed delivery (${providerKey})` } });
      await recomputeOrderStatus(tx, s.vendorOrder.orderId);
    }
  });
  if (u.status === "RETURNED" || u.status === "FAILED_ATTEMPT") {
    await raiseAlert({ dedupeKey: `shipment-exception:${s.id}`, type: "SHIPMENT_EXCEPTION", severity: "WARNING", title: `Shipment ${s.trackingNumber ?? s.id} ${u.status === "RETURNED" ? "returned to sender" : "failed delivery"}`, detail: u.note, link: `/admin/shipments?id=${s.id}` });
  }
  if (s.vendorOrder.order.userId && ["OUT_FOR_DELIVERY", "DELIVERED", "FAILED_ATTEMPT", "CUSTOMS_PROCESSING", "RETURNED"].includes(u.status)) {
    await notify(db, { userId: s.vendorOrder.order.userId, type: "order.tracking", title: `Shipment ${s.vendorOrder.number}: ${STATUS_LABEL[u.status].toLowerCase()}`, body: u.note ?? STATUS_LABEL[u.status], link: `/account/shipments` });
  }
  return "applied";
}

/** Pulls tracking from the provider (for carriers without webhooks, or on demand). */
export async function refreshTracking(shipmentId: string) {
  const s = await db.shipment.findUnique({ where: { id: shipmentId } });
  if (!s?.providerKey || !s.providerShipmentId) throw new ShippingError("This shipment isn't tracked through a carrier integration.");
  const adapter = shippingAdapter(s.providerKey);
  if (!adapter?.getTracking) throw new ShippingError(`${adapter?.name ?? s.providerKey} tracking isn't available through its API yet.`);
  let snap;
  try {
    const { ctx } = await requireShipping(s.providerKey, "TRACKING");
    snap = await adapter.getTracking(ctx, s.trackingNumber && s.providerKey === "dhl-express" ? s.trackingNumber : s.providerShipmentId);
  } catch (e) {
    if (e instanceof ProviderUnavailableError) throw new ShippingError(e.message);
    await db.shipment.update({ where: { id: s.id }, data: { lastPolledAt: new Date() } });
    throw new ShippingError(`Tracking lookup failed: ${(e as Error).message}`);
  }
  let added = 0;
  for (const e of snap.events) {
    const key = `${s.providerKey}:poll:${createHash("sha1").update(`${s.id}|${e.at.toISOString()}|${e.description}`).digest("hex")}`;
    if (await db.shipmentEvent.findUnique({ where: { providerEventId: key } })) continue;
    await db.shipmentEvent.create({ data: { shipmentId: s.id, status: s.status, note: e.description, location: e.location, providerEventId: key, createdAt: e.at } });
    added++;
  }
  await db.shipment.update({ where: { id: s.id }, data: { lastPolledAt: new Date(), ...(snap.trackingUrl ? { trackingUrl: snap.trackingUrl } : {}) } });
  // Only a status the adapter mapped from documented codes may change ours.
  if (snap.status) {
    const last = snap.events[snap.events.length - 1];
    await applyTrackingUpdate(s.providerKey, { eventKey: `poll-status:${snap.status}:${last?.at.toISOString() ?? ""}`, providerShipmentId: s.providerShipmentId, status: snap.status, note: last?.description, location: last?.location, occurredAt: last?.at ?? new Date(), payload: { source: "poll", rawStatus: snap.rawStatus } });
  }
  return { added, status: snap.status, rawStatus: snap.rawStatus };
}

/** Daily/periodic job: poll active carrier shipments whose provider has a tracking API. */
export async function pollActiveShipments(limit = 40) {
  const stale = new Date(Date.now() - 3 * 3600_000);
  const list = await db.shipment.findMany({
    where: { providerKey: { not: null }, providerShipmentId: { not: null }, status: { in: ACTIVE_STATUSES }, OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: stale } }] },
    orderBy: { lastPolledAt: { sort: "asc", nulls: "first" } }, take: limit, select: { id: true, providerKey: true },
  });
  let ok = 0, failed = 0;
  for (const s of list) {
    if (!shippingAdapter(s.providerKey!)?.getTracking) continue;
    try { await refreshTracking(s.id); ok++; } catch { failed++; }
  }
  return { polled: ok, failed };
}

export function shippingProviderName(key: string | null | undefined) {
  return key ? shippingAdapter(key)?.name ?? key : "Seller delivery";
}

export { ProviderUnavailableError };
