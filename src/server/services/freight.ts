/**
 * China → Nigeria freight (and other origin → Nigeria consolidations). None of the freight partners investigated
 * publishes an API (docs/SHIPPING_PROVIDERS.md), so this is a staff-operated workflow with full audit trail.
 * Legs, each its own Shipment row on the vendor sub-order:
 *   DIRECT       vendor → customer with an international courier (DHL etc.) — handled by services/shipping.ts
 *   TO_WAREHOUSE vendor → origin warehouse (vendor registers carrier + tracking)
 *   CONSOLIDATED origin warehouse → Nigeria in an AIR or SEA consolidation booked with a freight partner
 *   LAST_MILE    Nigerian hub → customer (manual dispatch or a domestic courier)
 * Money: only the partner's own quote/invoice amounts are recorded; customs duties/taxes are never calculated here.
 */
import { db } from "@/server/db";
import { audit } from "./audit";
import { notify } from "./notify";
import { recomputeOrderStatus } from "./orders";
import { shippingAdapter } from "@/server/integrations/registry";

export class FreightError extends Error {}

export const CONSOLIDATION_FLOW = ["OPEN", "BOOKED", "DEPARTED", "ARRIVED", "CUSTOMS", "CLEARED", "LAST_MILE", "CLOSED"] as const;
export type ConsolidationStatus = (typeof CONSOLIDATION_FLOW)[number] | "CANCELLED";
const SHIPMENT_STATUS_FOR: Partial<Record<ConsolidationStatus, "AWAITING_PICKUP" | "IN_TRANSIT" | "AT_SORTING_FACILITY" | "CUSTOMS_PROCESSING">> = {
  BOOKED: "AWAITING_PICKUP", DEPARTED: "IN_TRANSIT", ARRIVED: "AT_SORTING_FACILITY", CUSTOMS: "CUSTOMS_PROCESSING", CLEARED: "AT_SORTING_FACILITY",
};
export const CONSOLIDATION_LABEL: Record<string, string> = {
  OPEN: "Open — receiving parcels", BOOKED: "Booked with partner", DEPARTED: "Departed origin", ARRIVED: "Arrived in Nigeria", CUSTOMS: "Nigerian customs processing",
  CLEARED: "Cleared customs", LAST_MILE: "Last-mile delivery", CLOSED: "Closed", CANCELLED: "Cancelled",
};

// ─── Warehouses ──────────────────────────────────────────────────────────────

export async function saveWarehouse(actorId: string, input: { id?: string; code: string; name: string; country: string; city: string; address: string; contactName?: string; phone?: string; partnerKey?: string; role: "ORIGIN" | "DESTINATION"; active: boolean; notes?: string }) {
  if (!/^[A-Z0-9-]{3,20}$/.test(input.code)) throw new FreightError("Code: 3–20 capital letters, digits or dashes.");
  if (input.partnerKey && shippingAdapter(input.partnerKey)?.kind !== "SHIPPING") throw new FreightError("Unknown partner.");
  const data = { ...input, contactName: input.contactName || null, phone: input.phone || null, partnerKey: input.partnerKey || null, notes: input.notes || null };
  const { id, ...rest } = data;
  const w = id ? await db.warehouse.update({ where: { id }, data: rest }) : await db.warehouse.create({ data: rest });
  await audit(db, { actorId, action: id ? "warehouse.update" : "warehouse.create", entityType: "Warehouse", entityId: w.id, after: { code: w.code, role: w.role, partnerKey: w.partnerKey } });
  return w;
}

// ─── Vendor → origin warehouse ───────────────────────────────────────────────

export async function registerInbound(vendorId: string, actorId: string, input: { vendorOrderId: string; warehouseId: string; carrier?: string; tracking?: string; pieces?: number }) {
  const vo = await db.vendorOrder.findFirst({ where: { id: input.vendorOrderId, vendorId }, include: { order: true, vendor: true, shipments: true, items: true } });
  if (!vo) throw new FreightError("Order not found.");
  if (!["PROCESSING", "READY_FOR_DISPATCH"].includes(vo.status)) throw new FreightError("Accept the order before sending it to the warehouse.");
  if (vo.items.every((i) => i.kind !== "PHYSICAL")) throw new FreightError("Nothing to ship.");
  if (vo.shipments.some((s) => !["CANCELLED", "RETURNED"].includes(s.status))) throw new FreightError("This order already has a shipment.");
  const wh = await db.warehouse.findFirst({ where: { id: input.warehouseId, role: "ORIGIN", active: true } });
  if (!wh) throw new FreightError("Choose an active origin warehouse.");
  if (wh.country !== vo.vendor.country) throw new FreightError(`That warehouse is in ${wh.country}; your store ships from ${vo.vendor.country}.`);
  const dest = vo.order.shippingAddress as { country?: string } | null;
  return db.$transaction(async (tx) => {
    const s = await tx.shipment.create({
      data: {
        vendorOrderId: vo.id, carrier: input.carrier?.trim() || "Seller to warehouse", trackingNumber: input.tracking?.trim() || null, leg: "TO_WAREHOUSE",
        status: "IN_TRANSIT", method: "SELLER", international: false, originCountry: vo.vendor.country, destinationCountry: dest?.country ?? "NG", lastEventAt: new Date(), shippedAt: new Date(),
        items: { create: vo.items.filter((i) => i.kind === "PHYSICAL").map((i) => ({ orderItemId: i.id, quantity: i.quantity })) },
        events: { create: { status: "IN_TRANSIT", note: `Seller sent the parcel to ${wh.name} (${wh.code})` } },
      },
    });
    const r = await tx.warehouseReceipt.create({ data: { warehouseId: wh.id, vendorId, vendorOrderId: vo.id, shipmentId: s.id, inboundCarrier: input.carrier?.trim() || null, inboundTracking: input.tracking?.trim() || null, pieces: Math.max(1, input.pieces ?? 1) } });
    await tx.vendorOrder.update({ where: { id: vo.id }, data: { status: "SHIPPED" } });
    await tx.vendorOrderEvent.create({ data: { vendorOrderId: vo.id, status: "SHIPPED", note: `Sent to consolidation warehouse ${wh.code}`, actorId } });
    await recomputeOrderStatus(tx, vo.orderId);
    await audit(tx, { actorId, action: "freight.inbound.register", entityType: "WarehouseReceipt", entityId: r.id, after: { warehouse: wh.code } });
    if (vo.order.userId) await notify(tx, { userId: vo.order.userId, type: "order.shipped", title: `${vo.number} is on its way to the export warehouse`, body: `The seller sent your item to ${wh.city} for international shipping to Nigeria.`, link: "/account/shipments" });
    return r;
  });
}

// ─── Warehouse receiving ─────────────────────────────────────────────────────

export async function receiveParcel(actorId: string, receiptId: string, input: { weightGrams: number; lengthCm: number; widthCm: number; heightCm: number; pieces: number }) {
  const r = await db.warehouseReceipt.findUnique({ where: { id: receiptId }, include: { warehouse: true } });
  if (!r || r.status !== "EXPECTED") throw new FreightError("This parcel is not awaiting receipt.");
  for (const [k, v] of Object.entries(input)) if (!Number.isInteger(v) || v <= 0 || v > 1_000_000) throw new FreightError(`Enter a valid ${k}.`);
  await db.$transaction(async (tx) => {
    await tx.warehouseReceipt.update({ where: { id: r.id }, data: { status: "RECEIVED", ...input, receivedAt: new Date(), receivedById: actorId } });
    if (r.shipmentId) {
      await tx.shipment.update({ where: { id: r.shipmentId }, data: { status: "DELIVERED", deliveredAt: new Date(), lastEventAt: new Date(), weightGrams: input.weightGrams } });
      await tx.shipmentEvent.create({ data: { shipmentId: r.shipmentId, status: "DELIVERED", note: `Received at ${r.warehouse.name} (${r.warehouse.code}): ${input.pieces} piece(s), ${(input.weightGrams / 1000).toFixed(2)} kg`, location: r.warehouse.city } });
    }
    await audit(tx, { actorId, action: "freight.receipt.received", entityType: "WarehouseReceipt", entityId: r.id, after: input });
  });
}

export async function markReceiptException(actorId: string, receiptId: string, note: string) {
  if (note.trim().length < 5) throw new FreightError("Describe the problem.");
  const r = await db.warehouseReceipt.update({ where: { id: receiptId }, data: { status: "EXCEPTION", exceptionNote: note.trim() } });
  await audit(db, { actorId, action: "freight.receipt.exception", entityType: "WarehouseReceipt", entityId: r.id, after: { note } });
}

// ─── Consolidations ──────────────────────────────────────────────────────────

export async function createConsolidation(actorId: string, input: { mode: "AIR" | "SEA"; partnerKey: string; originWarehouseId: string }) {
  const partner = shippingAdapter(input.partnerKey);
  if (!partner) throw new FreightError("Choose a freight partner.");
  if (!partner.profile.freightModes.includes(input.mode)) throw new FreightError(`${partner.name} is not listed for ${input.mode.toLowerCase()} freight.`);
  const wh = await db.warehouse.findFirst({ where: { id: input.originWarehouseId, role: "ORIGIN" } });
  if (!wh) throw new FreightError("Choose an origin warehouse.");
  const n = (await db.freightConsolidation.count()) + 1;
  const c = await db.freightConsolidation.create({ data: { reference: `XC-FR-${String(n).padStart(4, "0")}`, mode: input.mode, partnerKey: input.partnerKey, originWarehouseId: wh.id, createdById: actorId, events: { create: { status: "OPEN", note: `${input.mode} consolidation opened at ${wh.code} with ${partner.name}`, actorId } } } });
  await audit(db, { actorId, action: "freight.consolidation.create", entityType: "FreightConsolidation", entityId: c.id, after: input });
  return c;
}

/** Adds received parcels: each becomes a CONSOLIDATED shipment leg on its vendor sub-order. */
export async function addToConsolidation(actorId: string, consolidationId: string, receiptIds: string[]) {
  const c = await db.freightConsolidation.findUnique({ where: { id: consolidationId } });
  if (!c || !["OPEN", "BOOKED"].includes(c.status)) throw new FreightError("Parcels can only be added before departure.");
  const receipts = await db.warehouseReceipt.findMany({ where: { id: { in: receiptIds }, status: "RECEIVED", warehouseId: c.originWarehouseId } });
  if (!receipts.length) throw new FreightError("Select received parcels from this consolidation's warehouse.");
  const partner = shippingAdapter(c.partnerKey);
  for (const r of receipts) {
    await db.$transaction(async (tx) => {
      await tx.warehouseReceipt.update({ where: { id: r.id }, data: { status: "CONSOLIDATED", consolidationId: c.id } });
      const vo = await tx.vendorOrder.findUniqueOrThrow({ where: { id: r.vendorOrderId }, include: { order: true, items: true } });
      await tx.shipment.create({
        data: {
          vendorOrderId: vo.id, carrier: partner?.name ?? c.partnerKey, leg: "CONSOLIDATED", consolidationId: c.id, method: c.mode === "AIR" ? "AIR_FREIGHT" : "SEA_FREIGHT",
          status: "PENDING", international: true, originCountry: (await tx.warehouse.findUniqueOrThrow({ where: { id: c.originWarehouseId } })).country, destinationCountry: c.destinationCountry,
          weightGrams: r.weightGrams, lastEventAt: new Date(), trackingNumber: c.partnerReference,
          items: { create: vo.items.filter((i) => i.kind === "PHYSICAL").map((i) => ({ orderItemId: i.id, quantity: i.quantity })) },
          events: { create: { status: "PENDING", note: `Added to ${c.mode.toLowerCase()} consolidation ${c.reference}` } },
        },
      });
    });
  }
  await audit(db, { actorId, action: "freight.consolidation.add", entityType: "FreightConsolidation", entityId: c.id, after: { receipts: receipts.map((r) => r.id) } });
  return receipts.length;
}

/** Records the partner's quote exactly as given. Nothing is estimated; excluded charges are stated. */
export async function recordPartnerQuote(actorId: string, consolidationId: string, input: { costMinor: bigint; currency: string; includes: string; excludes: string }) {
  if (input.costMinor <= 0n) throw new FreightError("Enter the partner's quoted amount.");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new FreightError("Currency must be a 3-letter code.");
  if (input.excludes.trim().length < 3) throw new FreightError("State what the quote excludes (e.g. Nigerian import duty and VAT).");
  await db.freightConsolidation.update({ where: { id: consolidationId }, data: { quotedCostMinor: input.costMinor, quotedCurrency: input.currency, quoteIncludes: input.includes.trim() || null, quoteExcludes: input.excludes.trim() } });
  await audit(db, { actorId, action: "freight.quote.record", entityType: "FreightConsolidation", entityId: consolidationId, after: { cost: input.costMinor.toString(), currency: input.currency } });
}

/** Moves a consolidation forward one milestone and mirrors it onto every parcel's shipment and customer. */
export async function advanceConsolidation(actorId: string, consolidationId: string, to: ConsolidationStatus, input: { note?: string; location?: string; partnerReference?: string; etd?: Date; eta?: Date } = {}) {
  const c = await db.freightConsolidation.findUnique({ where: { id: consolidationId }, include: { shipments: { where: { leg: "CONSOLIDATED" }, include: { vendorOrder: { include: { order: true } } } } } });
  if (!c) throw new FreightError("Consolidation not found.");
  if (to === "CANCELLED") {
    if (!["OPEN", "BOOKED"].includes(c.status)) throw new FreightError("Only consolidations that haven't departed can be cancelled.");
  } else {
    const from = CONSOLIDATION_FLOW.indexOf(c.status as (typeof CONSOLIDATION_FLOW)[number]);
    if (CONSOLIDATION_FLOW.indexOf(to) !== from + 1) throw new FreightError(`Next step after “${CONSOLIDATION_LABEL[c.status]}” is “${CONSOLIDATION_LABEL[CONSOLIDATION_FLOW[from + 1]] ?? "—"}”.`);
    if (to === "BOOKED" && !(input.partnerReference || c.partnerReference)) throw new FreightError("Enter the partner's booking reference (AWB / bill of lading).");
    if (to === "BOOKED" && !c.shipments.length) throw new FreightError("Add parcels before booking.");
  }
  const now = new Date();
  const status = SHIPMENT_STATUS_FOR[to];
  await db.$transaction(async (tx) => {
    await tx.freightConsolidation.update({
      where: { id: c.id },
      data: {
        status: to, ...(input.partnerReference ? { partnerReference: input.partnerReference.trim() } : {}), ...(input.etd ? { etd: input.etd } : {}), ...(input.eta ? { eta: input.eta } : {}),
        ...(to === "DEPARTED" ? { departedAt: now } : {}), ...(to === "ARRIVED" ? { arrivedAt: now } : {}), ...(to === "CLEARED" ? { clearedAt: now } : {}),
      },
    });
    await tx.freightEvent.create({ data: { consolidationId: c.id, status: to, note: input.note?.trim() || null, location: input.location?.trim() || null, actorId } });
    for (const s of c.shipments) {
      if (to === "CANCELLED") {
        await tx.shipment.update({ where: { id: s.id }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: input.note ?? "Consolidation cancelled" } });
        await tx.warehouseReceipt.updateMany({ where: { vendorOrderId: s.vendorOrderId, consolidationId: c.id }, data: { status: "RECEIVED", consolidationId: null } });
        continue;
      }
      if (!status) continue;
      await tx.shipment.update({ where: { id: s.id }, data: { status, lastEventAt: now, ...(input.partnerReference ? { trackingNumber: input.partnerReference.trim() } : {}), ...(to === "DEPARTED" ? { shippedAt: now } : {}) } });
      await tx.shipmentEvent.create({ data: { shipmentId: s.id, status, note: `${CONSOLIDATION_LABEL[to]}${input.note ? ` — ${input.note.trim()}` : ""}`, location: input.location?.trim() || null } });
    }
    if (to === "DEPARTED") await tx.warehouseReceipt.updateMany({ where: { consolidationId: c.id }, data: { status: "DISPATCHED" } });
  });
  await audit(db, { actorId, action: "freight.consolidation.advance", entityType: "FreightConsolidation", entityId: c.id, after: { to, ...input, eta: input.eta?.toISOString(), etd: input.etd?.toISOString() } });
  if (["DEPARTED", "ARRIVED", "CUSTOMS", "CLEARED"].includes(to)) {
    for (const s of c.shipments) if (s.vendorOrder.order.userId) {
      await notify(db, { userId: s.vendorOrder.order.userId, type: "order.tracking", title: `${s.vendorOrder.number}: ${CONSOLIDATION_LABEL[to].toLowerCase()}`, body: `${c.mode === "AIR" ? "Air" : "Sea"} freight ${c.reference}${to === "CUSTOMS" ? ". Import duties and taxes, if any, are set by Nigeria Customs." : ""}`, link: "/account/shipments" });
    }
  }
}

/** Last mile from the Nigerian hub: creates a LAST_MILE leg (manual courier/rider with tracking). */
export async function dispatchLastMile(actorId: string, consolidatedShipmentId: string, input: { carrier: string; trackingNumber?: string; trackingUrl?: string }) {
  const s = await db.shipment.findUnique({ where: { id: consolidatedShipmentId }, include: { consolidation: true, vendorOrder: { include: { order: true, items: true } } } });
  if (!s || s.leg !== "CONSOLIDATED" || !s.consolidation) throw new FreightError("Choose a consolidated parcel.");
  if (!["CLEARED", "LAST_MILE"].includes(s.consolidation.status)) throw new FreightError("Dispatch after the consolidation has cleared customs.");
  if (input.carrier.trim().length < 2) throw new FreightError("Enter the courier or rider company.");
  if (input.trackingUrl && !/^https:\/\//.test(input.trackingUrl)) throw new FreightError("Tracking link must start with https://");
  const existing = await db.shipment.findFirst({ where: { vendorOrderId: s.vendorOrderId, leg: "LAST_MILE", status: { notIn: ["CANCELLED", "RETURNED"] } } });
  if (existing) throw new FreightError("This parcel already has a last-mile delivery.");
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.shipment.update({ where: { id: s.id }, data: { status: "DELIVERED", deliveredAt: now, lastEventAt: now } });
    await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: "DELIVERED", note: "Handed to last-mile delivery in Nigeria" } });
    await tx.shipment.create({
      data: {
        vendorOrderId: s.vendorOrderId, carrier: input.carrier.trim(), trackingNumber: input.trackingNumber?.trim() || null, trackingUrl: input.trackingUrl?.trim() || null, leg: "LAST_MILE",
        method: "LOCAL_DISPATCH", status: "OUT_FOR_DELIVERY", originCountry: "NG", destinationCountry: "NG", lastEventAt: now, shippedAt: now,
        items: { create: s.vendorOrder.items.filter((i) => i.kind === "PHYSICAL").map((i) => ({ orderItemId: i.id, quantity: i.quantity })) },
        events: { create: { status: "OUT_FOR_DELIVERY", note: `Out for delivery with ${input.carrier.trim()}` } },
      },
    });
    await audit(tx, { actorId, action: "freight.lastmile.dispatch", entityType: "Shipment", entityId: s.id, after: input });
  });
  if (s.vendorOrder.order.userId) await notify(db, { userId: s.vendorOrder.order.userId, type: "order.tracking", title: `${s.vendorOrder.number} is out for delivery`, body: `${input.carrier}${input.trackingNumber ? ` · tracking ${input.trackingNumber}` : ""}`, link: "/account/shipments" });
}

/** Staff confirm final delivery of a last-mile leg (proof from the courier/rider). Strong evidence for settlement. */
export async function confirmFinalDelivery(actorId: string, lastMileShipmentId: string, recipientName: string) {
  const s = await db.shipment.findUnique({ where: { id: lastMileShipmentId }, include: { vendorOrder: true } });
  if (!s || s.leg !== "LAST_MILE" || s.status === "DELIVERED") throw new FreightError("Choose an undelivered last-mile shipment.");
  if (recipientName.trim().length < 2) throw new FreightError("Enter who received the parcel.");
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.shipment.update({ where: { id: s.id }, data: { status: "DELIVERED", deliveredAt: now, recipientName: recipientName.trim(), lastEventAt: now } });
    await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: "DELIVERED", note: `Delivered — received by ${recipientName.trim()}` } });
    if (s.vendorOrder.status === "SHIPPED") {
      await tx.vendorOrder.update({ where: { id: s.vendorOrderId }, data: { status: "DELIVERED", deliveredAt: now, deliveryEvidence: "ADMIN" } });
      await tx.vendorOrderEvent.create({ data: { vendorOrderId: s.vendorOrderId, status: "DELIVERED", note: "Final delivery confirmed by XavierConnect logistics", actorId } });
      await recomputeOrderStatus(tx, s.vendorOrder.orderId);
    }
    await audit(tx, { actorId, action: "freight.delivery.confirm", entityType: "Shipment", entityId: s.id, after: { recipientName } });
  });
  const c = await db.freightConsolidation.findFirst({ where: { shipments: { some: { vendorOrderId: s.vendorOrderId } } } });
  if (c && c.status === "LAST_MILE") {
    const open = await db.shipment.count({ where: { consolidationId: c.id, leg: "CONSOLIDATED", status: { not: "DELIVERED" } } });
    if (!open) {
      const undelivered = await db.shipment.count({ where: { leg: "LAST_MILE", status: { not: "DELIVERED" }, vendorOrderId: { in: (await db.shipment.findMany({ where: { consolidationId: c.id }, select: { vendorOrderId: true } })).map((x) => x.vendorOrderId) } } });
      if (!undelivered) await advanceConsolidation(actorId, c.id, "CLOSED", { note: "All parcels delivered" });
    }
  }
}

export async function addShippingInvoice(actorId: string, input: { providerKey: string; invoiceNumber: string; amountMinor: bigint; currency: string; issuedAt: Date; consolidationId?: string; shipmentId?: string; note?: string }) {
  if (input.amountMinor <= 0n) throw new FreightError("Enter the invoice amount.");
  if (!input.invoiceNumber.trim()) throw new FreightError("Enter the invoice number.");
  try {
    const inv = await db.shippingInvoice.create({ data: { ...input, invoiceNumber: input.invoiceNumber.trim(), consolidationId: input.consolidationId || null, shipmentId: input.shipmentId || null, note: input.note || null, createdById: actorId } });
    await audit(db, { actorId, action: "shipping.invoice.add", entityType: "ShippingInvoice", entityId: inv.id, after: { provider: input.providerKey, amount: input.amountMinor.toString(), currency: input.currency } });
    return inv;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new FreightError("That invoice number is already recorded for this provider.");
    throw e;
  }
}
