/**
 * Carrier-integrated shipping for vendor sub-orders. Each sub-order ships independently; a carrier
 * "delivered" event becomes CARRIER delivery evidence for that sub-order only.
 */
import { db } from "@/server/db";
import { requireShipping, shippingAdapter } from "@/server/integrations/registry";
import { ProviderUnavailableError, type Rate, type TrackingUpdate } from "@/server/integrations/types";
import { audit } from "./audit";
import { notify } from "./notify";
import { recomputeOrderStatus } from "./orders";

export class ShippingError extends Error {}

export interface CustomsInput {
  contents: string;
  declaredValueMinor: bigint;
  currency: string;
  hsCodes: string[];
  incoterm: "DAP" | "DDP";
  insured: boolean;
}

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

export async function getShippingQuotes(vendorId: string, vendorOrderId: string, providerKey: string, pickupAddressId: string, dims: { length: number; width: number; height: number }) {
  const vo = await vendorOrderForShipping(vendorId, vendorOrderId);
  const pickup = await db.pickupAddress.findFirst({ where: { id: pickupAddressId, vendorId } });
  if (!pickup) throw new ShippingError("Choose a pickup address.");
  const to = vo.order.shippingAddress as { fullName: string; phone: string; line1: string; city: string; state: string; country?: string } | null;
  if (!to) throw new ShippingError("This order has no delivery address.");
  let adapterCtx;
  try { adapterCtx = await requireShipping(providerKey, "RATE_QUOTE"); } catch (e) { throw new ShippingError((e as Error).message); }
  const { adapter, ctx } = adapterCtx;
  const route = `${pickup.country}>${to.country ?? "NG"}`;
  if (!adapter.routes.includes(route)) throw new ShippingError(`${adapter.name} does not serve ${route.replace(">", " → ")}.`);
  const customer = vo.order.userId ? await db.user.findUnique({ where: { id: vo.order.userId }, select: { email: true } }) : null;
  const codes = (pickup.providerAddressCodes ?? {}) as Record<string, string | number>;
  let result;
  try {
    result = await adapter.quote!(ctx, {
      origin: { name: pickup.contactName, phone: pickup.phone, email: pickup.email, line1: pickup.line1, city: pickup.city, region: pickup.region, country: pickup.country, postalCode: pickup.postalCode, providerCode: codes[providerKey] ?? null },
      destination: { name: to.fullName, phone: to.phone, email: customer?.email ?? vo.order.guestEmail ?? "customer@xavierconnect.com", line1: to.line1, city: to.city, region: to.state, country: to.country ?? "NG" },
      items: vo.items.filter((i) => i.kind === "PHYSICAL").map((i) => ({ name: i.name, description: i.name, unitValueMinor: i.unitPriceMinor, quantity: i.quantity, weightGrams: i.product?.weightGrams ?? 500 })),
      dimensionsCm: dims,
      pickupDate: new Date(Date.now() + vo.vendor.handlingDays * 864e5).toISOString().slice(0, 10),
      currency: "NGN",
    });
  } catch (e) {
    throw new ShippingError(`${adapter.name} could not quote: ${(e as Error).message}`);
  }
  await db.shippingQuote.deleteMany({ where: { vendorOrderId, providerKey } });
  const rows = [];
  for (const r of result.rates) {
    rows.push(await db.shippingQuote.create({ data: { providerKey, vendorId, vendorOrderId, providerRequestRef: result.requestRef, courierId: r.courierId, serviceCode: r.serviceCode, courierName: r.courierName, amountMinor: r.amountMinor, currency: r.currency, etaText: r.etaText, expiresAt: new Date(Date.now() + 30 * 60_000) } }));
  }
  return { rows, international: pickup.country !== (to.country ?? "NG"), origin: pickup.country, destination: to.country ?? "NG" };
}

export async function buyLabel(vendorId: string, quoteId: string, actorId: string, customs?: CustomsInput) {
  const q = await db.shippingQuote.findFirst({ where: { id: quoteId, vendorId } });
  if (!q || !q.vendorOrderId) throw new ShippingError("Quote not found.");
  if (q.expiresAt && q.expiresAt < new Date()) throw new ShippingError("This quote has expired. Get new quotes.");
  const vo = await vendorOrderForShipping(vendorId, q.vendorOrderId);
  const existing = vo.shipments.find((s) => s.providerKey && s.status !== "RETURNED");
  if (existing) throw new ShippingError("A carrier shipment already exists for this order.");
  const pickup = await db.pickupAddress.findFirst({ where: { vendorId, isDefault: true } }) ?? await db.pickupAddress.findFirst({ where: { vendorId } });
  const destCountry = ((vo.order.shippingAddress as { country?: string } | null)?.country) ?? "NG";
  const international = (pickup?.country ?? vo.vendor.country) !== destCountry;
  if (international && !customs) throw new ShippingError("International shipments need a customs declaration.");
  if (customs && (!customs.contents.trim() || customs.declaredValueMinor <= 0n)) throw new ShippingError("Describe the contents and declare their value.");

  let adapterCtx;
  try { adapterCtx = await requireShipping(q.providerKey, "CREATE_SHIPMENT"); } catch (e) { throw new ShippingError((e as Error).message); }
  const { adapter, ctx } = adapterCtx;
  const rate: Rate = { courierId: q.courierId ?? "", serviceCode: q.serviceCode, courierName: q.courierName, amountMinor: q.amountMinor, currency: q.currency, etaText: q.etaText ?? undefined };
  let created;
  try {
    created = await adapter.createShipment!(ctx, { requestRef: q.providerRequestRef ?? "", rate, reference: vo.number, customs: customs ? { incoterm: customs.incoterm, insured: customs.insured } : undefined });
  } catch (e) {
    throw new ShippingError(`${adapter.name} could not create the shipment: ${(e as Error).message}`);
  }
  const weight = vo.items.reduce((a, i) => a + (i.product?.weightGrams ?? 0) * i.quantity, 0);
  const shipment = await db.$transaction(async (tx) => {
    const s = await tx.shipment.create({
      data: {
        vendorOrderId: vo.id, carrier: created.courierName ?? q.courierName, trackingNumber: created.trackingNumber ?? null, trackingUrl: created.trackingUrl ?? null,
        labelUrl: created.labelUrl ?? null, status: "PENDING", providerKey: q.providerKey, providerShipmentId: created.providerShipmentId, service: q.serviceCode,
        costMinor: q.amountMinor, costCurrency: q.currency, international, originCountry: pickup?.country ?? vo.vendor.country, destinationCountry: destCountry, weightGrams: weight || null,
      },
    });
    await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: "PENDING", note: `Label created with ${adapter.name} (${q.courierName})` } });
    if (customs) {
      await tx.customsDeclaration.create({
        data: {
          shipmentId: s.id, contents: customs.contents, declaredValueMinor: customs.declaredValueMinor, currency: customs.currency, originCountry: pickup?.country ?? vo.vendor.country,
          hsCodes: customs.hsCodes, incoterm: customs.incoterm, insured: customs.insured,
          items: vo.items.map((i) => ({ name: i.name, quantity: i.quantity, unitValueMinor: i.unitPriceMinor.toString() })),
        },
      });
    }
    await tx.vendorOrder.update({ where: { id: vo.id }, data: { status: "SHIPPED" } });
    await tx.vendorOrderEvent.create({ data: { vendorOrderId: vo.id, status: "SHIPPED", note: `${adapter.name}: ${q.courierName}${created.trackingNumber ? `, tracking ${created.trackingNumber}` : ""}`, actorId } });
    await recomputeOrderStatus(tx, vo.orderId);
    await audit(tx, { actorId, action: "shipment.create", entityType: "Shipment", entityId: s.id, after: { provider: q.providerKey, international } });
    return s;
  });
  if (vo.order.userId) {
    await notify(db, { userId: vo.order.userId, type: "order.shipped", title: `Part of ${vo.order.number} has shipped`, body: `${q.courierName}${created.trackingNumber ? ` · tracking ${created.trackingNumber}` : ""}.`, link: `/account/orders/${vo.order.number}` });
  }
  return shipment;
}

const ORDER: TrackingUpdate["status"][] = ["PENDING", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"];

/** Applies a verified carrier event. Idempotent via ShipmentEvent.providerEventId. */
export async function applyTrackingUpdate(providerKey: string, u: TrackingUpdate) {
  const s = await db.shipment.findFirst({ where: { providerKey, providerShipmentId: u.providerShipmentId }, include: { vendorOrder: { include: { order: true } } } });
  if (!s) throw new Error(`Unknown ${providerKey} shipment ${u.providerShipmentId}`);
  const dup = await db.shipmentEvent.findUnique({ where: { providerEventId: `${providerKey}:${u.eventKey}` } });
  if (dup) return "noop";
  await db.$transaction(async (tx) => {
    await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: u.status, note: u.note, location: u.location, providerEventId: `${providerKey}:${u.eventKey}`, createdAt: u.occurredAt } });
    // Don't move backwards on out-of-order events (except to exception states).
    const forward = ORDER.indexOf(u.status) >= ORDER.indexOf(s.status as TrackingUpdate["status"]) || ["FAILED_ATTEMPT", "RETURNED"].includes(u.status);
    await tx.shipment.update({ where: { id: s.id }, data: { lastEventAt: u.occurredAt, ...(forward ? { status: u.status } : {}), ...(u.status === "DELIVERED" ? { deliveredAt: u.occurredAt } : {}), ...(u.status === "PICKED_UP" && !s.shippedAt ? { shippedAt: u.occurredAt } : {}) } });
    if (u.status === "DELIVERED" && ["SHIPPED", "DELIVERED"].includes(s.vendorOrder.status)) {
      await tx.vendorOrder.update({ where: { id: s.vendorOrderId }, data: { status: "DELIVERED", deliveredAt: s.vendorOrder.deliveredAt ?? u.occurredAt, deliveryEvidence: "CARRIER" } });
      await tx.vendorOrderEvent.create({ data: { vendorOrderId: s.vendorOrderId, status: "DELIVERED", note: `Carrier confirmed delivery (${providerKey})` } });
      await recomputeOrderStatus(tx, s.vendorOrder.orderId);
    }
  });
  if (s.vendorOrder.order.userId && ["OUT_FOR_DELIVERY", "DELIVERED", "FAILED_ATTEMPT"].includes(u.status)) {
    const t = { OUT_FOR_DELIVERY: "is out for delivery", DELIVERED: "was delivered", FAILED_ATTEMPT: "had a failed delivery attempt" }[u.status as "OUT_FOR_DELIVERY"];
    await notify(db, { userId: s.vendorOrder.order.userId, type: "order.tracking", title: `Shipment ${s.vendorOrder.number} ${t}`, body: u.note ?? t, link: `/account/orders/${s.vendorOrder.order.number}` });
  }
  return "applied";
}

export function shippingProviderName(key: string | null | undefined) {
  return key ? shippingAdapter(key)?.name ?? key : "Vendor delivery";
}

export { ProviderUnavailableError };
