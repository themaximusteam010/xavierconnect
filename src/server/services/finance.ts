/**
 * Settlement, payouts and refunds. Every money movement is a balanced ledger transaction with an
 * idempotency key, so retries and double-clicks cannot move money twice.
 */
import { db, type DbClient, type Tx } from "@/server/db";
import { accountBalance, postLedger, PlatformAccounts, vendorAccountCode, vendorBalances } from "@/server/domain/ledger";
import { getProvider } from "@/server/payments";
import { getSetting } from "./settings";
import { notify } from "./notify";
import { audit } from "./audit";
import { recomputeOrderStatus } from "./orders";

export class FinanceError extends Error {}

/**
 * Move vendor earnings from pending → available for vendor orders delivered at least
 * `holdDays` ago (the return/dispute window). Orders with an open dispute are skipped.
 */
export const STRONG_EVIDENCE = ["CARRIER", "RIDER_POD", "CUSTOMER_CONFIRMED", "DIGITAL", "SERVICE_COMPLETED", "ADMIN"];

export async function releaseSettlements(now = new Date(), holdDays?: number) {
  const hold = holdDays ?? (await getSetting(db, "settlementHoldDays"));
  const claimHold = await getSetting(db, "vendorClaimHoldDays");
  const cutoff = new Date(now.getTime() - hold * 864e5);
  const claimCutoff = new Date(now.getTime() - Math.max(hold, claimHold) * 864e5);
  const due = await db.vendorOrder.findMany({
    where: {
      status: "DELIVERED",
      settledAt: null,
      disputes: { none: { status: { in: ["OPEN", "AWAITING_VENDOR", "UNDER_REVIEW"] } } },
      OR: [
        // Verified delivery evidence: normal hold window.
        { deliveryEvidence: { in: STRONG_EVIDENCE }, deliveredAt: { lte: cutoff } },
        // Only the vendor's own claim: longer window for the customer to object.
        { OR: [{ deliveryEvidence: "VENDOR_CLAIM" }, { deliveryEvidence: null }], deliveredAt: { lte: claimCutoff } },
      ],
    },
    select: { id: true },
  });
  let released = 0;
  for (const { id } of due) {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "VendorOrder" WHERE id = ${id} FOR UPDATE`;
      const vo = await tx.vendorOrder.findUniqueOrThrow({ where: { id }, include: { vendor: true } });
      if (vo.settledAt || vo.status !== "DELIVERED") return;
      await postLedger(tx, {
        kind: "SETTLEMENT_RELEASE",
        reference: vo.number,
        idempotencyKey: `settle:${vo.id}`,
        description: `Earnings released for ${vo.number}`,
        entries: [
          { account: vendorAccountCode(vo.vendorId, "pending"), debit: vo.vendorNetMinor },
          { account: vendorAccountCode(vo.vendorId, "available"), credit: vo.vendorNetMinor },
        ],
      });
      await tx.vendorOrder.update({ where: { id }, data: { status: "COMPLETED", settledAt: now } });
      await tx.vendorOrderEvent.create({ data: { vendorOrderId: id, status: "COMPLETED", note: "Earnings released to available balance" } });
      await recomputeOrderStatus(tx, vo.orderId);
      released++;
    });
  }
  return released;
}

// ─── Payouts ───────────────────────────────────────────────────────────────────

export async function requestPayout(vendorId: string, amountMinor: bigint, actorId: string, idempotencyKey: string) {
  const minPayout = BigInt(await getSetting(db, "minPayoutMinor"));
  if (amountMinor < minPayout) throw new FinanceError(`The minimum withdrawal is ₦${(minPayout / 100n).toLocaleString()}.`);
  return db.$transaction(async (tx) => {
    const existing = await tx.payout.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;
    const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: vendorId } });
    if (vendor.status !== "APPROVED") throw new FinanceError("Your store must be approved to withdraw.");
    const beneficiary = await tx.beneficiary.findFirst({ where: { vendorId, status: "VERIFIED", isDefault: true, disabledAt: null } });
    if (!beneficiary) throw new FinanceError("Add a verified payout account in Payments & payouts first.");
    const corridor = await resolveCorridor(tx, beneficiary.country, beneficiary.currency, beneficiary.providerKey);
    // Serialise per vendor so two concurrent requests cannot both pass the balance check.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"payout:" + vendorId}))`;
    const available = await accountBalance(tx, vendorAccountCode(vendorId, "available"));
    if (amountMinor > available) throw new FinanceError("Amount exceeds your available balance.");
    const payout = await tx.payout.create({
      data: {
        vendorId, amountMinor, idempotencyKey, currency: "NGN", beneficiaryId: beneficiary.id, providerKey: beneficiary.providerKey,
        method: corridor.method, settlementCurrency: beneficiary.currency,
        settlementAmountMinor: beneficiary.currency === "NGN" ? amountMinor : null,
      },
    });
    await tx.payoutEvent.create({ data: { payoutId: payout.id, status: "REQUESTED", message: `To ${beneficiary.bankName} ••••${beneficiary.accountLast4} (${beneficiary.currency})` } });
    await postLedger(tx, {
      kind: "PAYOUT_REQUESTED",
      reference: payout.id,
      idempotencyKey: `payout-hold:${payout.id}`,
      description: `Withdrawal requested`,
      entries: [
        { account: vendorAccountCode(vendorId, "available"), debit: amountMinor },
        { account: vendorAccountCode(vendorId, "payout_hold"), credit: amountMinor },
      ],
    });
    await audit(tx, { actorId, action: "payout.request", entityType: "Payout", entityId: payout.id, after: { amountMinor, beneficiaryId: beneficiary.id } });
    return payout;
  });
}

/** A corridor must exist and be enabled. LIVE corridors additionally need compliance sign-off. */
export async function resolveCorridor(tx: DbClient, country: string, currency: string, providerKey: string) {
  if (providerKey === "manual" && country === "NG" && currency === "NGN") return { method: "LOCAL", status: "LIVE" };
  const c = await tx.payoutCorridor.findUnique({ where: { country_currency_providerKey: { country, currency, providerKey } } });
  if (!c || c.status === "DISABLED") throw new FinanceError(`Payouts to ${country} in ${currency} are not available yet.`);
  if (c.status === "LIVE" && !c.complianceApproved) throw new FinanceError(`The ${country}/${currency} payout route is awaiting compliance approval.`);
  if (c.status === "SANDBOX" && process.env.NODE_ENV === "production" && process.env.ALLOW_SANDBOX_PAYMENTS !== "true") {
    throw new FinanceError(`The ${country}/${currency} payout route is only enabled in test mode.`);
  }
  return c;
}

export async function lockPayout(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Payout" WHERE id = ${id} FOR UPDATE`;
  return tx.payout.findUniqueOrThrow({ where: { id }, include: { vendor: true } });
}

/** Finance approves and records the completed bank transfer. */
export async function markPayoutPaid(payoutId: string, actorId: string | null, providerRef: string, opts: { providerConfirmed?: boolean } = {}) {
  return db.$transaction(async (tx) => {
    const p = await lockPayout(tx, payoutId);
    if (p.status === "PAID") return p;
    if (!["REQUESTED", "APPROVED", "PROCESSING"].includes(p.status)) throw new FinanceError(`Payout is ${p.status}.`);
    // API providers are only marked paid by their own confirmation (webhook), never by hand.
    if (p.providerKey && p.providerKey !== "manual" && !opts.providerConfirmed) {
      throw new FinanceError("This payout is sent through a payment provider; it is marked paid only when the provider confirms it.");
    }
    await postLedger(tx, {
      kind: "PAYOUT_PAID",
      reference: p.id,
      idempotencyKey: `payout-paid:${p.id}`,
      description: `Payout transferred (${providerRef})`,
      entries: [
        { account: vendorAccountCode(p.vendorId, "payout_hold"), debit: p.amountMinor },
        { account: PlatformAccounts.clearing.code, credit: p.amountMinor },
      ],
    });
    const updated = await tx.payout.update({
      where: { id: p.id },
      data: { status: "PAID", providerRef, ...(actorId ? { reviewedById: actorId, reviewedAt: new Date() } : {}), paidAt: new Date() },
    });
    await tx.payoutEvent.create({ data: { payoutId: p.id, status: "PAID", message: opts.providerConfirmed ? `Provider confirmed (${providerRef})` : `Bank reference recorded (${providerRef})` } });
    await audit(tx, { actorId, action: "payout.paid", entityType: "Payout", entityId: p.id, before: { status: p.status }, after: { status: "PAID", providerRef } });
    await notify(tx, { userId: p.vendor.ownerId, type: "payout.update", title: "Withdrawal paid", body: `Your withdrawal has been transferred. Reference ${providerRef}.`, link: "/vendor/payouts" });
    return updated;
  });
}

/** Reject a request or record a failed transfer: funds return to the vendor's available balance. */
export async function failPayout(payoutId: string, actorId: string | null, reason: string, status: "REJECTED" | "FAILED") {
  return db.$transaction(async (tx) => {
    const p = await lockPayout(tx, payoutId);
    if (p.status === "REJECTED" || p.status === "FAILED") return p;
    if (p.status === "PAID") throw new FinanceError("Paid payouts cannot be reversed here.");
    await postLedger(tx, {
      kind: "PAYOUT_RETURNED",
      reference: p.id,
      idempotencyKey: `payout-return:${p.id}`,
      description: `Payout ${status.toLowerCase()}: ${reason}`,
      entries: [
        { account: vendorAccountCode(p.vendorId, "payout_hold"), debit: p.amountMinor },
        { account: vendorAccountCode(p.vendorId, "available"), credit: p.amountMinor },
      ],
    });
    const updated = await tx.payout.update({ where: { id: p.id }, data: { status, failureReason: reason, ...(actorId ? { reviewedById: actorId, reviewedAt: new Date() } : {}) } });
    await tx.payoutEvent.create({ data: { payoutId: p.id, status, message: reason } });
    await audit(tx, { actorId, action: `payout.${status.toLowerCase()}`, entityType: "Payout", entityId: p.id, before: { status: p.status }, after: { status, reason } });
    await notify(tx, { userId: p.vendor.ownerId, type: "payout.update", title: "Withdrawal not completed", body: `${reason}. The amount is back in your available balance.`, link: "/vendor/payouts" });
    return updated;
  });
}

// ─── Refunds ───────────────────────────────────────────────────────────────────

/**
 * Full refund of one vendor sub-order. Reverses the capture for that slice: vendor earnings,
 * commission and tax are taken back, platform-funded discount is un-expensed, and the amount
 * the customer actually paid for this slice leaves clearing.
 */
export async function refundVendorOrder(vendorOrderId: string, actorId: string, reason: string) {
  const pre = await db.vendorOrder.findUniqueOrThrow({ where: { id: vendorOrderId }, include: { order: { include: { payments: true } } } });
  const payment = pre.order.payments.find((p) => p.status === "SUCCEEDED");
  if (!payment) throw new FinanceError("This order has no successful payment to refund.");

  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "VendorOrder" WHERE id = ${vendorOrderId} FOR UPDATE`;
    const vo = await tx.vendorOrder.findUniqueOrThrow({ where: { id: vendorOrderId }, include: { order: true, items: true, vendor: true } });
    if (vo.status === "REFUNDED") return { already: true as const, vo };
    const from = vo.settledAt ? "available" : "pending";
    if (vo.settledAt) {
      const bal = await vendorBalances(tx, vo.vendorId);
      if (bal.available < vo.vendorNetMinor) throw new FinanceError("Vendor balance is insufficient; resolve through the dispute process.");
    }
    const pd = vo.vendorNetMinor + vo.commissionMinor + vo.taxMinor - vo.totalMinor;
    await postLedger(tx, {
      kind: "REFUND",
      reference: vo.number,
      idempotencyKey: `refund:${vo.id}`,
      description: `Refund for ${vo.number}: ${reason}`,
      entries: [
        { account: vendorAccountCode(vo.vendorId, from), debit: vo.vendorNetMinor },
        { account: PlatformAccounts.commission.code, debit: vo.commissionMinor },
        { account: PlatformAccounts.taxPayable.code, debit: vo.taxMinor },
        { account: PlatformAccounts.promotions.code, credit: pd },
        { account: PlatformAccounts.clearing.code, credit: vo.totalMinor },
      ],
    });
    const refund = await tx.refund.upsert({
      where: { idempotencyKey: `refund:${vo.id}` },
      update: {},
      create: {
        orderId: vo.orderId,
        vendorOrderId: vo.id,
        paymentId: payment.id,
        amountMinor: vo.totalMinor,
        reason,
        status: "PROCESSING",
        idempotencyKey: `refund:${vo.id}`,
        requestedById: actorId,
        decidedById: actorId,
      },
    });
    // Return physical stock
    for (const it of vo.items) {
      if (it.kind !== "PHYSICAL" || !it.productId) continue;
      if (it.variantId) await tx.productVariant.update({ where: { id: it.variantId }, data: { stockQuantity: { increment: it.quantity } } });
      else await tx.product.update({ where: { id: it.productId }, data: { stockQuantity: { increment: it.quantity } } });
    }
    await tx.downloadGrant.updateMany({ where: { orderItemId: { in: vo.items.map((i) => i.id) } }, data: { revokedAt: new Date() } });
    await tx.vendorOrder.update({ where: { id: vo.id }, data: { status: "REFUNDED" } });
    await tx.vendorOrderEvent.create({ data: { vendorOrderId: vo.id, status: "REFUNDED", note: reason, actorId } });
    const all = await tx.vendorOrder.findMany({ where: { orderId: vo.orderId } });
    const allRefunded = all.every((x) => x.status === "REFUNDED" || x.status === "CANCELLED");
    await tx.order.update({ where: { id: vo.orderId }, data: { paymentStatus: allRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    await recomputeOrderStatus(tx, vo.orderId);
    await audit(tx, { actorId, action: "refund.issue", entityType: "VendorOrder", entityId: vo.id, after: { amountMinor: vo.totalMinor, reason } });
    if (vo.order.userId) {
      await notify(tx, { userId: vo.order.userId, type: "refund.update", title: `Refund started for ${vo.number}`, body: `We are refunding your payment for this shipment. Reason: ${reason}.`, link: `/account/orders/${vo.order.number}` });
    }
    await notify(tx, { userId: vo.vendor.ownerId, type: "refund.update", title: `Order ${vo.number} refunded`, body: reason, link: `/vendor/orders/${vo.id}`, email: false });
    return { already: false as const, vo, refund };
  });

  if (!result.already) {
    // Provider call happens outside the DB transaction; failures leave the refund in PROCESSING for retry.
    try {
      const r = await getProvider(payment.provider).refund(payment.reference, result.vo.totalMinor);
      await db.refund.update({ where: { idempotencyKey: `refund:${vendorOrderId}` }, data: { status: "COMPLETED", providerRef: r.providerRef } });
    } catch (e) {
      await db.refund.update({ where: { idempotencyKey: `refund:${vendorOrderId}` }, data: { status: "FAILED" } });
      throw new FinanceError(`Ledger updated but the provider refund failed: ${(e as Error).message}`);
    }
  }
  return result;
}

/** Trial balance: every account's debit and credit totals. Must net to zero overall. */
export async function trialBalance() {
  const rows = await db.$queryRaw<{ code: string; name: string; type: string; debit: bigint; credit: bigint }[]>`
    SELECT a.code, a.name, a.type::text AS type,
           COALESCE(SUM(e."debitMinor"),0)::bigint AS debit, COALESCE(SUM(e."creditMinor"),0)::bigint AS credit
      FROM "LedgerAccount" a LEFT JOIN "LedgerEntry" e ON e."accountId" = a.id
     GROUP BY a.id ORDER BY a.code`;
  return rows;
}
