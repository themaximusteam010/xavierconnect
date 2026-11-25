/**
 * Customer delivery confirmation and disputes.
 * An open dispute blocks settlement of that vendor sub-order (see releaseSettlements).
 * Workflow: customer opens → vendor notified (AWAITING_VENDOR) → both add evidence → staff review
 * (UNDER_REVIEW) → authorised admin decides → refund (via refundVendorOrder) or release → CLOSED.
 */
import { db } from "@/server/db";
import { audit } from "./audit";
import { notify } from "./notify";
import { refundVendorOrder } from "./finance";
import { recomputeOrderStatus } from "./orders";

export class DisputeError extends Error {}

export async function confirmReceipt(customerId: string, vendorOrderId: string) {
  const vo = await db.vendorOrder.findFirst({ where: { id: vendorOrderId, order: { userId: customerId } }, include: { order: true } });
  if (!vo) throw new DisputeError("Shipment not found.");
  if (!["SHIPPED", "DELIVERED"].includes(vo.status)) throw new DisputeError("You can confirm receipt once the seller has shipped.");
  if (vo.deliveryEvidence === "CUSTOMER_CONFIRMED") return;
  await db.$transaction(async (tx) => {
    await tx.vendorOrder.update({ where: { id: vo.id }, data: { status: "DELIVERED", deliveredAt: vo.deliveredAt ?? new Date(), deliveryEvidence: "CUSTOMER_CONFIRMED" } });
    await tx.vendorOrderEvent.create({ data: { vendorOrderId: vo.id, status: "DELIVERED", note: "Customer confirmed receipt", actorId: customerId } });
    await recomputeOrderStatus(tx, vo.orderId);
  });
}

const REASONS = ["Item not received", "Item not as described", "Damaged item", "Wrong item", "Counterfeit", "Service not provided", "Other"] as const;
export const DISPUTE_REASONS = REASONS;

export async function openDispute(customerId: string, vendorOrderId: string, reason: string, description: string) {
  if (!(REASONS as readonly string[]).includes(reason)) throw new DisputeError("Choose a reason.");
  if (description.trim().length < 20) throw new DisputeError("Please describe the problem in at least 20 characters.");
  const vo = await db.vendorOrder.findFirst({ where: { id: vendorOrderId, order: { userId: customerId } }, include: { order: true, vendor: true, disputes: true } });
  if (!vo) throw new DisputeError("Shipment not found.");
  if (vo.status === "REFUNDED" || vo.status === "CANCELLED" || vo.status === "AWAITING_PAYMENT") throw new DisputeError("This shipment can't be disputed.");
  if (vo.settledAt) throw new DisputeError("The dispute window for this shipment has closed. Open a support ticket instead.");
  if (vo.disputes.some((d) => !["CLOSED", "RESOLVED_CUSTOMER", "RESOLVED_VENDOR"].includes(d.status))) throw new DisputeError("There is already an open dispute for this shipment.");
  const d = await db.dispute.create({
    data: { orderId: vo.orderId, vendorOrderId: vo.id, openedById: customerId, reason, description: description.trim(), status: "AWAITING_VENDOR", evidence: { create: { authorId: customerId, party: "CUSTOMER", body: description.trim() } } },
  });
  await audit(db, { actorId: customerId, action: "dispute.open", entityType: "Dispute", entityId: d.id, after: { vendorOrder: vo.number, reason } });
  await notify(db, { userId: vo.vendor.ownerId, type: "dispute.update", title: `Dispute opened on ${vo.number}`, body: `${reason}. Respond with your evidence within 3 days. Earnings for this order are on hold.`, link: `/vendor/orders/${vo.id}` });
  return d;
}

export async function addEvidence(disputeId: string, authorId: string, party: "CUSTOMER" | "VENDOR" | "STAFF", body: string, scope: { customerId?: string; vendorId?: string }) {
  const d = await db.dispute.findFirst({
    where: { id: disputeId, ...(scope.customerId ? { openedById: scope.customerId } : {}), ...(scope.vendorId ? { vendorOrder: { vendorId: scope.vendorId } } : {}) },
  });
  if (!d) throw new DisputeError("Dispute not found.");
  if (["CLOSED", "RESOLVED_CUSTOMER", "RESOLVED_VENDOR"].includes(d.status)) throw new DisputeError("This dispute is closed.");
  if (body.trim().length < 5) throw new DisputeError("Add a little more detail.");
  await db.disputeEvidence.create({ data: { disputeId, authorId, party, body: body.trim().slice(0, 5000) } });
  if (party === "VENDOR" && d.status === "AWAITING_VENDOR") await db.dispute.update({ where: { id: d.id }, data: { status: "UNDER_REVIEW" } });
}

/** Authorised decision (dispute.decide). Refunds use the normal ledger-reversing refund. */
export async function decideDispute(disputeId: string, actorId: string, outcome: "REFUND_CUSTOMER" | "RELEASE_VENDOR", resolution: string) {
  if (resolution.trim().length < 10) throw new DisputeError("Record the reasoning for the decision.");
  const d = await db.dispute.findUniqueOrThrow({ where: { id: disputeId }, include: { vendorOrder: { include: { vendor: true } }, order: true } });
  if (["CLOSED", "RESOLVED_CUSTOMER", "RESOLVED_VENDOR"].includes(d.status)) throw new DisputeError("Already decided.");
  if (outcome === "REFUND_CUSTOMER" && d.vendorOrder.status !== "REFUNDED") {
    await refundVendorOrder(d.vendorOrderId, actorId, `Dispute decided for customer: ${d.reason}`);
  }
  await db.dispute.update({ where: { id: d.id }, data: { status: outcome === "REFUND_CUSTOMER" ? "RESOLVED_CUSTOMER" : "RESOLVED_VENDOR", resolution: resolution.trim(), decidedById: actorId, decidedAt: new Date() } });
  await db.disputeEvidence.create({ data: { disputeId: d.id, authorId: actorId, party: "STAFF", body: `Decision: ${outcome === "REFUND_CUSTOMER" ? "refund the customer" : "release to the vendor"}. ${resolution.trim()}` } });
  await audit(db, { actorId, action: "dispute.decide", entityType: "Dispute", entityId: d.id, after: { outcome, resolution } });
  const msg = outcome === "REFUND_CUSTOMER" ? "The customer is being refunded." : "The order stands; earnings follow the normal settlement schedule.";
  await notify(db, { userId: d.openedById, type: "dispute.update", title: `Dispute on ${d.vendorOrder.number} decided`, body: `${msg} ${resolution.trim()}`, link: `/account/orders/${d.order.number}` });
  await notify(db, { userId: d.vendorOrder.vendor.ownerId, type: "dispute.update", title: `Dispute on ${d.vendorOrder.number} decided`, body: msg, link: `/vendor/orders/${d.vendorOrderId}` });
}
