/**
 * Checkout, payment confirmation and fulfilment.
 *
 * Invariants:
 *  - One parent Order per checkout; one VendorOrder per vendor in it.
 *  - Stock is decremented atomically at placement (conditional UPDATE) and recorded as a
 *    reservation. Paid → reservation COMMITTED. Failed/expired → RELEASED and stock returned.
 *  - Payment confirmation is idempotent (row lock + status check) and posts exactly one
 *    ledger capture per order (ledger idempotency key).
 */
import { randomBytes } from "node:crypto";
import { db, type DbClient, type Tx } from "@/server/db";
import { postLedger, PlatformAccounts, vendorAccountCode, type EntryInput } from "@/server/domain/ledger";
import { sum } from "@/lib/money";
import { getProvider } from "@/server/payments";
import { CartError, loadCartView, type CartIdent } from "./cart";
import { getSetting } from "./settings";
import { notify, appUrl } from "./notify";
import { audit } from "./audit";
import type { VendorOrderStatus } from "@prisma/client";

export interface ShippingAddressInput {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  country: string;
}

export interface PlaceOrderInput {
  ident: CartIdent;
  email: string;
  address: ShippingAddressInput | null;
  shippingChoice: Record<string, string>;
}

const letter = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : "");

export async function nextOrderNumber(tx: DbClient) {
  const [row] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_number_seq') AS n`;
  return `XC-${row.n}`;
}

export async function placeOrder(input: PlaceOrderInput) {
  const reservationMinutes = await getSetting(db, "reservationMinutes");
  const result = await db.$transaction(
    async (tx) => {
      const view = await loadCartView(tx, input.ident, input.shippingChoice);
      if (!view || view.items.length === 0) throw new CartError("Your cart is empty.");
      const { pricing, items } = view;
      const needsAddress = items.some((i) => i.product.type === "PHYSICAL");
      if (needsAddress && !input.address) throw new CartError("A delivery address is required.");
      for (const v of pricing.vendors) {
        const hasPhysical = v.lines.some((l) => l.kind === "PHYSICAL");
        if (hasPhysical && !view.shippingByVendor[v.vendorId]) {
          const store = items.find((i) => i.product.vendorId === v.vendorId)?.product.vendor.store?.name;
          throw new CartError(`${store ?? "A seller"} has not set up delivery yet. Remove their items to continue.`);
        }
      }

      // Reserve stock atomically.
      const itemById = new Map(items.map((i) => [i.id, i]));
      for (const v of pricing.vendors) {
        for (const l of v.lines) {
          const ci = itemById.get(l.key)!;
          if (ci.product.type !== "PHYSICAL" || !ci.product.trackInventory) continue;
          const n = ci.variantKey
            ? await tx.productVariant.updateMany({
                where: { id: ci.variantKey, stockQuantity: { gte: l.quantity } },
                data: { stockQuantity: { decrement: l.quantity } },
              })
            : await tx.product.updateMany({
                where: { id: ci.productId, stockQuantity: { gte: l.quantity } },
                data: { stockQuantity: { decrement: l.quantity } },
              });
          if (n.count === 0) throw new CartError(`${ci.product.name} just sold out or has fewer units than you selected.`);
        }
      }

      const number = await nextOrderNumber(tx);
      const order = await tx.order.create({
        data: {
          number,
          userId: input.ident.userId ?? null,
          guestEmail: input.ident.userId ? null : input.email,
          subtotalMinor: pricing.subtotalMinor,
          discountMinor: pricing.discountMinor,
          shippingMinor: pricing.shippingMinor,
          taxMinor: pricing.taxMinor,
          totalMinor: pricing.totalMinor,
          couponCode: pricing.couponApplied ? view.couponCode : null,
          shippingAddress: input.address ? { ...input.address } : undefined,
          contactPhone: input.address?.phone ?? null,
        },
      });

      for (const [idx, v] of pricing.vendors.entries()) {
        const vo = await tx.vendorOrder.create({
          data: {
            number: `${number}-${letter(idx)}`,
            orderId: order.id,
            vendorId: v.vendorId,
            subtotalMinor: v.subtotalMinor,
            discountMinor: v.vendorDiscountMinor + v.platformDiscountMinor,
            shippingMinor: v.shippingMinor,
            taxMinor: v.taxMinor,
            totalMinor: v.totalMinor,
            commissionMinor: v.commissionMinor,
            vendorNetMinor: v.vendorNetMinor,
            shippingMethodId: view.shippingByVendor[v.vendorId]?.id ?? null,
          },
        });
        for (const l of v.lines) {
          const ci = itemById.get(l.key)!;
          const variant = ci.variantKey ? ci.product.variants.find((x) => x.id === ci.variantKey) : null;
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              vendorOrderId: vo.id,
              kind: l.kind,
              productId: ci.productId,
              variantId: variant?.id ?? null,
              name: variant ? `${ci.product.name} — ${variant.name}` : ci.product.name,
              sku: variant?.sku ?? ci.product.sku,
              unitPriceMinor: l.unitPriceMinor,
              quantity: l.quantity,
              lineTotalMinor: l.lineTotalMinor,
              discountMinor: l.vendorDiscountMinor + l.platformDiscountMinor,
              commissionMinor: l.commissionMinor,
              commissionRuleId: l.commissionRuleId,
            },
          });
          if (ci.product.type === "PHYSICAL" && ci.product.trackInventory) {
            await tx.inventoryReservation.create({
              data: {
                productId: ci.productId,
                variantId: variant?.id ?? null,
                orderId: order.id,
                quantity: l.quantity,
                expiresAt: new Date(Date.now() + reservationMinutes * 60_000),
              },
            });
          }
        }
      }

      const provider = getProvider();
      const reference = `${number}-${randomBytes(4).toString("hex")}`;
      await tx.payment.create({
        data: { orderId: order.id, provider: provider.name, reference, amountMinor: order.totalMinor, currency: order.currency },
      });
      await tx.cartItem.deleteMany({ where: { cartId: view.cart.id } });
      await tx.cart.update({ where: { id: view.cart.id }, data: { couponCode: null } });
      return { order, reference, providerName: provider.name };
    },
    { timeout: 20_000 },
  );

  return result;
}

/** Start (or restart) payment for an unpaid order. Returns the provider's hosted page URL. */
export async function startPayment(orderId: string, email: string) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: { orderBy: { createdAt: "desc" } } } });
  if (order.paymentStatus === "PAID") throw new CartError("This order is already paid.");
  if (order.status === "CANCELLED") throw new CartError("This order has expired. Please place it again.");
  const provider = getProvider();
  let payment = order.payments.find((p) => p.status === "INITIATED" && p.provider === provider.name);
  if (!payment) {
    payment = await db.payment.create({
      data: {
        orderId: order.id,
        provider: provider.name,
        reference: `${order.number}-${randomBytes(4).toString("hex")}`,
        amountMinor: order.totalMinor,
        currency: order.currency,
      },
    });
  }
  const { authorizationUrl } = await provider.initialize({
    reference: payment.reference,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    email,
    callbackUrl: appUrl(`/checkout/callback?reference=${encodeURIComponent(payment.reference)}`),
  });
  return authorizationUrl;
}

async function releaseReservations(tx: Tx, orderId: string) {
  const res = await tx.inventoryReservation.findMany({ where: { orderId, status: "ACTIVE" } });
  for (const r of res) {
    if (r.variantId) await tx.productVariant.update({ where: { id: r.variantId }, data: { stockQuantity: { increment: r.quantity } } });
    else await tx.product.update({ where: { id: r.productId }, data: { stockQuantity: { increment: r.quantity } } });
    await tx.inventoryReservation.update({ where: { id: r.id }, data: { status: "RELEASED" } });
  }
}

export type ConfirmOutcome = "paid" | "already_paid" | "failed" | "pending" | "needs_review";

/**
 * Verify a payment with its provider and, if successful, finalise the order. Safe to call
 * any number of times from the redirect callback and from webhooks concurrently.
 */
export async function confirmPayment(reference: string): Promise<{ outcome: ConfirmOutcome; orderNumber: string }> {
  const payment = await db.payment.findUnique({ where: { reference }, include: { order: true } });
  if (!payment) throw new Error("Unknown payment reference");
  if (payment.status === "SUCCEEDED") return { outcome: "already_paid", orderNumber: payment.order.number };

  const provider = getProvider(payment.provider);
  const v = await provider.verify(reference);

  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE reference = ${reference} FOR UPDATE`;
      const p = await tx.payment.findUniqueOrThrow({ where: { reference }, include: { order: true } });
      const order = p.order;
      if (p.status === "SUCCEEDED") return { outcome: "already_paid" as const, orderNumber: order.number };

      if (v.status === "pending") return { outcome: "pending" as const, orderNumber: order.number };

      if (v.status === "failed") {
        await tx.payment.update({ where: { id: p.id }, data: { status: "FAILED", failureReason: "Declined by provider", providerPayload: p.providerPayload ?? undefined } });
        return { outcome: "failed" as const, orderNumber: order.number };
      }

      // success — but never trust it blindly
      if (v.amountMinor !== p.amountMinor || v.currency !== p.currency || p.amountMinor !== order.totalMinor) {
        await tx.payment.update({ where: { id: p.id }, data: { status: "FAILED", failureReason: `Amount/currency mismatch: got ${v.amountMinor} ${v.currency}` } });
        await audit(tx, { actorId: null, action: "payment.mismatch", entityType: "Payment", entityId: p.id, after: { expected: p.amountMinor, got: v.amountMinor } });
        return { outcome: "needs_review" as const, orderNumber: order.number };
      }

      await tx.payment.update({ where: { id: p.id }, data: { status: "SUCCEEDED", verifiedAt: new Date(), channel: v.channel } });

      if (order.paymentStatus === "PAID") {
        // A second successful payment for an already-paid order: refund it, do not double-capture.
        await tx.refund.create({
          data: { orderId: order.id, paymentId: p.id, amountMinor: p.amountMinor, reason: "Duplicate payment", idempotencyKey: `dup:${p.id}` },
        });
        return { outcome: "needs_review" as const, orderNumber: order.number };
      }
      if (order.status === "CANCELLED") {
        await tx.refund.create({
          data: { orderId: order.id, paymentId: p.id, amountMinor: p.amountMinor, reason: "Paid after reservation expired", idempotencyKey: `late:${p.id}` },
        });
        return { outcome: "needs_review" as const, orderNumber: order.number };
      }

      await finaliseOrder(tx, order.id);
      return { outcome: "paid" as const, orderNumber: order.number };
    },
    { timeout: 20_000 },
  );
}

async function finaliseOrder(tx: Tx, orderId: string) {
  const now = new Date();
  const order = await tx.order.update({
    where: { id: orderId },
    data: { status: "PAID", paymentStatus: "PAID", paidAt: now },
    include: { vendorOrders: { include: { items: true, vendor: true } }, items: true },
  });

  await tx.inventoryReservation.updateMany({ where: { orderId, status: "ACTIVE" }, data: { status: "COMMITTED" } });
  if (order.couponCode) await tx.coupon.update({ where: { code: order.couponCode }, data: { usedCount: { increment: 1 } } });
  for (const it of order.items) {
    if (it.productId) await tx.product.update({ where: { id: it.productId }, data: { salesCount: { increment: it.quantity } } });
  }

  // Ledger capture
  const entries: EntryInput[] = [{ account: PlatformAccounts.clearing.code, debit: order.totalMinor }];
  let platformDiscount = 0n;
  for (const vo of order.vendorOrders) {
    const pd = vo.vendorNetMinor + vo.commissionMinor + vo.taxMinor - vo.totalMinor;
    platformDiscount += pd;
    entries.push({ account: vendorAccountCode(vo.vendorId, "pending"), credit: vo.vendorNetMinor });
  }
  await postLedger(tx, {
    kind: "PAYMENT_CAPTURED",
    reference: order.number,
    idempotencyKey: `capture:${order.id}`,
    description: `Payment captured for ${order.number}`,
    entries: [
      ...entries,
      { account: PlatformAccounts.promotions.code, debit: platformDiscount },
      { account: PlatformAccounts.commission.code, credit: sum(order.vendorOrders.map((v) => v.commissionMinor)) },
      { account: PlatformAccounts.taxPayable.code, credit: sum(order.vendorOrders.map((v) => v.taxMinor)) },
    ],
  });

  const grantDays = await getSetting(tx, "downloadExpiryDays");
  const grantMax = await getSetting(tx, "downloadMaxCount");

  for (const vo of order.vendorOrders) {
    const allDigital = vo.items.every((i) => i.kind === "DIGITAL");
    const status: VendorOrderStatus = allDigital ? "DELIVERED" : "NEW";
    await tx.vendorOrder.update({ where: { id: vo.id }, data: { status, deliveredAt: allDigital ? now : null } });
    await tx.vendorOrderEvent.create({ data: { vendorOrderId: vo.id, status, note: allDigital ? "Digital delivery on payment" : "Payment confirmed" } });

    for (const it of vo.items.filter((i) => i.kind === "DIGITAL" && i.productId)) {
      if (!order.userId) continue;
      const assets = await tx.digitalAsset.findMany({ where: { productId: it.productId! } });
      for (const a of assets) {
        await tx.downloadGrant.upsert({
          where: { orderItemId_assetId: { orderItemId: it.id, assetId: a.id } },
          update: {},
          create: { userId: order.userId, assetId: a.id, orderItemId: it.id, maxDownloads: grantMax, expiresAt: new Date(now.getTime() + grantDays * 864e5) },
        });
      }
    }
    await tx.booking.updateMany({ where: { orderItemId: { in: vo.items.map((i) => i.id) }, status: "PENDING_PAYMENT" }, data: { status: "REQUESTED" } });

    await notify(tx, {
      userId: vo.vendor.ownerId,
      type: "order.new",
      title: `New order ${vo.number}`,
      body: `You have a new paid order with ${vo.items.length} item(s).`,
      link: `/vendor/orders/${vo.id}`,
    });
  }

  if (order.userId) {
    await notify(tx, {
      userId: order.userId,
      type: "payment.success",
      title: `Payment received for ${order.number}`,
      body: "Thank you. Your sellers have been notified and will begin processing your order.",
      link: `/account/orders/${order.number}`,
    });
  }
}

/** Cancel unpaid orders whose reservations expired and return their stock. Run every few minutes. */
export async function expireUnpaidOrders(now = new Date()) {
  const expired = await db.inventoryReservation.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: now } },
    select: { orderId: true },
    distinct: ["orderId"],
  });
  let count = 0;
  for (const { orderId } of expired) {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (o.paymentStatus === "PAID") return;
      await releaseReservations(tx, orderId);
      await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED", cancelledAt: now } });
      await tx.vendorOrder.updateMany({ where: { orderId }, data: { status: "CANCELLED" } });
      await tx.payment.updateMany({ where: { orderId, status: "INITIATED" }, data: { status: "ABANDONED" } });
      count++;
    });
  }
  return count;
}

// ─── Fulfilment ────────────────────────────────────────────────────────────────

const TRANSITIONS: Partial<Record<VendorOrderStatus, VendorOrderStatus[]>> = {
  NEW: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["READY_FOR_DISPATCH", "CANCELLED"],
  READY_FOR_DISPATCH: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
};

export function allowedNextStatuses(s: VendorOrderStatus): VendorOrderStatus[] {
  return TRANSITIONS[s] ?? [];
}

export class FulfilmentError extends Error {}

/** Vendor-side status change. `vendorId` is the tenant boundary: the row must belong to it. */
export async function updateVendorOrderStatus(
  vendorId: string,
  vendorOrderId: string,
  next: VendorOrderStatus,
  actorId: string,
  extra: { carrier?: string; trackingNumber?: string; note?: string } = {},
) {
  return db.$transaction(async (tx) => {
    const vo = await tx.vendorOrder.findFirst({ where: { id: vendorOrderId, vendorId }, include: { order: true } });
    if (!vo) throw new FulfilmentError("Order not found.");
    if (!allowedNextStatuses(vo.status).includes(next)) throw new FulfilmentError(`Cannot move an order from ${vo.status} to ${next}.`);
    if (next === "CANCELLED") throw new FulfilmentError("Use the cancel-and-refund action for paid orders.");

    const now = new Date();
    await tx.vendorOrder.update({ where: { id: vo.id }, data: { status: next, deliveredAt: next === "DELIVERED" ? now : undefined } });
    await tx.vendorOrderEvent.create({ data: { vendorOrderId: vo.id, status: next, note: extra.note, actorId } });

    if (next === "SHIPPED") {
      const shipment = await tx.shipment.create({
        data: { vendorOrderId: vo.id, carrier: extra.carrier || "Vendor delivery", trackingNumber: extra.trackingNumber || null, status: "IN_TRANSIT", shippedAt: now },
      });
      await tx.shipmentEvent.create({ data: { shipmentId: shipment.id, status: "IN_TRANSIT", note: "Dispatched by seller" } });
    }
    if (next === "DELIVERED") {
      const shipments = await tx.shipment.findMany({ where: { vendorOrderId: vo.id } });
      for (const s of shipments) {
        await tx.shipment.update({ where: { id: s.id }, data: { status: "DELIVERED", deliveredAt: now } });
        await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: "DELIVERED" } });
      }
    }
    await recomputeOrderStatus(tx, vo.orderId);
    if (vo.order.userId && (next === "SHIPPED" || next === "DELIVERED")) {
      await notify(tx, {
        userId: vo.order.userId,
        type: next === "SHIPPED" ? "order.shipped" : "order.delivered",
        title: next === "SHIPPED" ? `Part of ${vo.order.number} has shipped` : `Part of ${vo.order.number} was delivered`,
        body: next === "SHIPPED" ? `Shipment ${vo.number} is on its way${extra.trackingNumber ? ` (tracking ${extra.trackingNumber})` : ""}.` : `Shipment ${vo.number} has been delivered.`,
        link: `/account/orders/${vo.order.number}`,
      });
    }
  });
}

export async function recomputeOrderStatus(tx: Tx, orderId: string) {
  const vos = await tx.vendorOrder.findMany({ where: { orderId } });
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.paymentStatus !== "PAID" && order.paymentStatus !== "PARTIALLY_REFUNDED") return;
  const live = vos.filter((v) => !["CANCELLED", "REFUNDED"].includes(v.status));
  const done = (s: string) => ["DELIVERED", "COMPLETED"].includes(s);
  let status = order.status;
  if (live.length === 0) status = "REFUNDED";
  else if (live.every((v) => done(v.status))) status = live.length === vos.length ? "FULFILLED" : "PARTIALLY_REFUNDED";
  else if (live.some((v) => ["SHIPPED", "DELIVERED", "COMPLETED"].includes(v.status))) status = "PARTIALLY_FULFILLED";
  else status = live.length === vos.length ? "PAID" : "PARTIALLY_REFUNDED";
  if (status !== order.status) await tx.order.update({ where: { id: orderId }, data: { status } });
}
