/**
 * Customer returns of delivered sub-orders. The seller (or staff) decides; the customer ships it back with tracking;
 * the seller confirms receipt; the refund runs through the normal ledger refund (refundVendorOrder). An open return
 * pauses settlement of that sub-order (see releaseSettlements). Failed deliveries / returned-to-sender parcels are
 * handled by the carrier status RETURNED plus an admin alert (services/shipping.ts).
 */
import { db } from "@/server/db";
import { audit } from "./audit";
import { notify } from "./notify";
import { getSetting } from "./settings";
import { refundVendorOrder } from "./finance";

export class ReturnError extends Error {}
export const RETURN_REASONS = ["Damaged on arrival", "Wrong item sent", "Item not as described", "Missing parts", "Changed my mind (if the seller allows)", "Other"] as const;
const OPEN = ["REQUESTED", "APPROVED", "IN_TRANSIT", "RECEIVED"];

export async function requestReturn(customerId: string, vendorOrderId: string, reason: string, details: string) {
  if (!(RETURN_REASONS as readonly string[]).includes(reason)) throw new ReturnError("Choose a reason.");
  const vo = await db.vendorOrder.findFirst({ where: { id: vendorOrderId, order: { userId: customerId } }, include: { shippingReturns: true, vendor: true, items: true } });
  if (!vo) throw new ReturnError("Order not found.");
  if (vo.status !== "DELIVERED" || !vo.deliveredAt) throw new ReturnError("Returns can be requested once the order has been delivered.");
  if (vo.items.every((i) => i.kind !== "PHYSICAL")) throw new ReturnError("Digital items and services can't be returned this way. Open a support ticket instead.");
  if (vo.settledAt) throw new ReturnError("The return window for this order has closed. Open a support ticket if something is wrong.");
  const days = await getSetting(db, "returnWindowDays");
  if (Date.now() - vo.deliveredAt.getTime() > days * 864e5) throw new ReturnError(`Returns must be requested within ${days} days of delivery.`);
  if (vo.shippingReturns.some((r) => OPEN.includes(r.status))) throw new ReturnError("There's already a return in progress for this order.");
  const r = await db.shippingReturn.create({ data: { vendorOrderId: vo.id, requestedById: customerId, reason, details: details.trim().slice(0, 1000) || null } });
  await audit(db, { actorId: customerId, action: "return.request", entityType: "ShippingReturn", entityId: r.id, after: { reason } });
  await notify(db, { userId: vo.vendor.ownerId, type: "order.return", title: `Return requested for ${vo.number}`, body: `${reason}. Approve or reject it from the order page. Earnings for this order are paused until it's resolved.`, link: `/vendor/orders/${vo.id}` });
  return r;
}

async function forActor(returnId: string, actor: { id: string; vendorId?: string; staff?: boolean }) {
  const r = await db.shippingReturn.findFirst({ where: { id: returnId, ...(actor.staff ? {} : { vendorOrder: { vendorId: actor.vendorId ?? "-" } }) }, include: { vendorOrder: { include: { order: true, vendor: true } } } });
  if (!r) throw new ReturnError("Return not found.");
  return r;
}

export async function decideReturn(actor: { id: string; vendorId?: string; staff?: boolean }, returnId: string, approve: boolean, note: string) {
  const r = await forActor(returnId, actor);
  if (r.status !== "REQUESTED") throw new ReturnError("This return has already been decided.");
  if (!approve && note.trim().length < 5) throw new ReturnError("Tell the customer why the return is rejected.");
  await db.shippingReturn.update({ where: { id: r.id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: actor.id, decidedAt: new Date(), decisionNote: note.trim() || null } });
  await audit(db, { actorId: actor.id, action: approve ? "return.approve" : "return.reject", entityType: "ShippingReturn", entityId: r.id, after: { note } });
  await notify(db, { userId: r.requestedById, type: "order.return", title: `Return for ${r.vendorOrder.number} ${approve ? "approved" : "rejected"}`, body: approve ? `Send the item back to the seller and add the tracking number on your Shipments page. ${note}` : `${note} You can open a dispute if you disagree.`, link: "/account/shipments" });
}

export async function markReturnShipped(customerId: string, returnId: string, carrier: string, trackingNumber: string) {
  const r = await db.shippingReturn.findFirst({ where: { id: returnId, requestedById: customerId }, include: { vendorOrder: { include: { vendor: true, items: true } } } });
  if (!r || r.status !== "APPROVED") throw new ReturnError("This return isn't waiting to be sent.");
  if (carrier.trim().length < 2 || trackingNumber.trim().length < 3) throw new ReturnError("Enter the courier and tracking number.");
  await db.$transaction(async (tx) => {
    const s = await tx.shipment.create({
      data: {
        vendorOrderId: r.vendorOrderId, carrier: carrier.trim(), trackingNumber: trackingNumber.trim(), leg: "RETURN", status: "IN_TRANSIT", method: "SELLER", originCountry: "NG", destinationCountry: r.vendorOrder.vendor.country,
        lastEventAt: new Date(), shippedAt: new Date(), items: { create: r.vendorOrder.items.filter((i) => i.kind === "PHYSICAL").map((i) => ({ orderItemId: i.id, quantity: i.quantity })) },
        events: { create: { status: "IN_TRANSIT", note: "Customer sent the return" } },
      },
    });
    await tx.shippingReturn.update({ where: { id: r.id }, data: { status: "IN_TRANSIT", returnShipmentId: s.id } });
  });
  await notify(db, { userId: r.vendorOrder.vendor.ownerId, type: "order.return", title: `Return for ${r.vendorOrder.number} is on its way`, body: `${carrier} · ${trackingNumber}. Confirm when you receive it.`, link: `/vendor/orders/${r.vendorOrderId}` });
}

/** Seller/staff confirm the item came back; then the customer is refunded through the ledger. */
export async function receiveReturnAndRefund(actor: { id: string; vendorId?: string; staff?: boolean }, returnId: string, note: string) {
  const r = await forActor(returnId, actor);
  if (r.status !== "IN_TRANSIT") throw new ReturnError("Mark the return received after the customer has sent it.");
  await db.shippingReturn.update({ where: { id: r.id }, data: { status: "RECEIVED", decisionNote: note.trim() || r.decisionNote } });
  if (r.returnShipmentId) {
    await db.shipment.update({ where: { id: r.returnShipmentId }, data: { status: "DELIVERED", deliveredAt: new Date(), lastEventAt: new Date() } });
    await db.shipmentEvent.create({ data: { shipmentId: r.returnShipmentId, status: "DELIVERED", note: "Seller received the return" } });
  }
  await refundVendorOrder(r.vendorOrderId, actor.id, `Return received: ${r.reason}`);
  await db.shippingReturn.update({ where: { id: r.id }, data: { status: "REFUNDED" } });
  await audit(db, { actorId: actor.id, action: "return.refund", entityType: "ShippingReturn", entityId: r.id });
  await notify(db, { userId: r.requestedById, type: "order.return", title: `Refund for ${r.vendorOrder.number}`, body: "The seller received your return and your refund has been issued.", link: `/account/orders/${r.vendorOrder.order.number}` });
}
