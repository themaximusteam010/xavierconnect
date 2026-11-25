/**
 * International operations against a real database, using the SANDBOX payout/FX/shipping simulators
 * (real partners are not connected). Covers acceptance tests 1–6 and 9–12.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { syncRbac } from "../../prisma/rbac-sync";
import { seedIntegrations } from "../../prisma/seed-lib";
import { hashPassword } from "@/server/auth/password";
import { addToCart } from "@/server/services/cart";
import { confirmPayment, placeOrder, updateVendorOrderStatus } from "@/server/services/orders";
import { FinanceError, markPayoutPaid, releaseSettlements, requestPayout, trialBalance } from "@/server/services/finance";
import { addBeneficiary, approveAndInitiatePayout, payoutReference } from "@/server/services/payouts";
import { ingestWebhook } from "@/server/services/webhooks";
import { buyLabel, getShippingQuotes } from "@/server/services/shipping";
import { confirmReceipt, decideDispute, openDispute } from "@/server/services/disputes";
import { sandboxPayoutCallback } from "@/server/integrations/payments/sandbox";
import { sandboxTrackingCallback } from "@/server/integrations/shipping/sandbox";
import { vendorBalances } from "@/server/domain/ledger";

process.env.ENCRYPTION_KEY ??= "1".repeat(64);
const address = { fullName: "Ada Buyer", phone: "08030000001", line1: "2 Marina Road", city: "Lagos Island", state: "Lagos", country: "NG" };
let adminId: string, buyerId: string;
const V: Record<"ng" | "cn", { id: string; ownerId: string; productId: string }> = {} as never;

async function user(email: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: "CUSTOMER" } });
  return db.user.create({ data: { email, name: email.split("@")[0], passwordHash: await hashPassword("Password123!"), emailVerifiedAt: new Date(), roles: { create: { roleId: role.id } } } });
}

async function vendor(tag: "ng" | "cn", country: string, currency: string, price: bigint) {
  const owner = await user(`${tag}-vendor@intl.test`);
  const cat = await db.category.upsert({ where: { slug: "intl-cat" }, update: {}, create: { slug: "intl-cat", name: "Intl", kind: "PRODUCT" } });
  const v = await db.vendor.create({
    data: {
      ownerId: owner.id, type: "BUSINESS", status: "APPROVED", businessName: `${tag.toUpperCase()} Supplier`, email: owner.email, phone: "+8613800000000",
      country, payoutCurrency: currency, city: tag === "cn" ? "Guangzhou" : "Ikeja", state: tag === "cn" ? null : "Lagos", region: tag === "cn" ? "Guangdong" : null,
      store: { create: { slug: `${tag}-supplier`, name: `${tag.toUpperCase()} Supplier` } },
      shippingMethods: { create: { name: tag === "cn" ? "Air freight China → Nigeria" : "Lagos delivery", type: "FLAT", rateMinor: 200_000n, destinationCountries: ["NG"] } },
      pickupAddresses: { create: { label: "Warehouse", contactName: "Dispatch", phone: "+8613800000000", email: owner.email, line1: "1 Warehouse Rd", city: tag === "cn" ? "Guangzhou" : "Ikeja", region: tag === "cn" ? "Guangdong" : "Lagos", country, isDefault: true } },
    },
  });
  await db.userRole.create({ data: { userId: owner.id, roleId: (await db.role.findUniqueOrThrow({ where: { key: "VENDOR" } })).id, vendorId: v.id } });
  const p = await db.product.create({ data: { vendorId: v.id, categoryId: cat.id, name: `${tag} item`, slug: `${tag}-item`, description: "Test item", priceMinor: price, stockQuantity: 10, weightGrams: 800, status: "PUBLISHED" } });
  V[tag] = { id: v.id, ownerId: owner.id, productId: p.id };
}

async function deliver(provider: string, cb: { body: string; headers: Headers }) {
  return ingestWebhook(provider, cb.body, cb.headers);
}

async function booksBalance() {
  const rows = await trialBalance();
  expect(rows.reduce((a, r) => a + r.debit, 0n)).toBe(rows.reduce((a, r) => a + r.credit, 0n));
}

beforeAll(async () => {
  await syncRbac(db);
  await seedIntegrations(db);
  await db.commissionRule.create({ data: { scope: "GLOBAL", name: "Default", rateBps: 1000 } });
  adminId = (await user("admin@intl.test")).id;
  buyerId = (await user("buyer@intl.test")).id;
  await vendor("ng", "NG", "NGN", 5_000_000n); // ₦50,000
  await vendor("cn", "CN", "CNY", 10_000_000n); // ₦100,000
});

describe("Tests 1–2: payout onboarding by country", () => {
  it("Nigerian vendor connects an NGN NUBAN account", async () => {
    const r = await addBeneficiary(V.ng.id, V.ng.ownerId, "sandbox-payouts", { country: "NG", currency: "NGN", routingType: "NUBAN", accountHolderName: "NG Supplier Ltd", bankName: "GTBank", bankCode: "058", accountNumber: "0123456789" });
    expect(r.beneficiary.status).toBe("VERIFIED");
    expect(r.beneficiary.isDefault).toBe(true);
    expect(r.beneficiary.accountLast4).toBe("6789");
    expect(r.beneficiary.detailsEnc).toBeNull(); // tokenised → full number not retained
  });
  it("Chinese vendor connects a CNY CNAPS beneficiary through the cross-border partner", async () => {
    const r = await addBeneficiary(V.cn.id, V.cn.ownerId, "sandbox-crossborder", { country: "CN", currency: "CNY", routingType: "CNAPS", accountHolderName: "Guangzhou Supplier Co", bankName: "Bank of China", branch: "Tianhe", accountNumber: "6216601234567890", extra: { cnaps: "104581000123" } });
    expect(r.beneficiary.status).toBe("VERIFIED");
  });
  it("refuses the ChamsSwitch corridor until partnership approval", async () => {
    await expect(addBeneficiary(V.cn.id, V.cn.ownerId, "chamsswitch-kardit", { country: "CN", currency: "CNY", routingType: "CNAPS", accountHolderName: "X", bankName: "BOC", accountNumber: "6216601234567890" })).rejects.toThrow(/not available yet/);
  });
  it("refuses accounts outside the vendor's country", async () => {
    await expect(addBeneficiary(V.ng.id, V.ng.ownerId, "sandbox-crossborder", { country: "CN", currency: "CNY", routingType: "CNAPS", accountHolderName: "X", bankName: "BOC", accountNumber: "6216601234567890" })).rejects.toThrow(/country of registration/);
  });
});

describe("Tests 3–12: purchase, shipping, settlement, payouts", () => {
  let orderId: string;
  let ngVo: string, cnVo: string;

  it("Tests 3–5: one NGN checkout across a Nigerian and a Chinese vendor creates two sub-orders with their own settlement currencies", async () => {
    await addToCart(db, { userId: buyerId }, V.ng.productId, 1);
    await addToCart(db, { userId: buyerId }, V.cn.productId, 1);
    const { order, reference } = await placeOrder({ ident: { userId: buyerId }, email: "buyer@intl.test", address, shippingChoice: {} });
    orderId = order.id;
    await db.payment.update({ where: { reference }, data: { providerPayload: { sandboxOutcome: "approve" } } });
    expect((await confirmPayment(reference)).outcome).toBe("paid");
    const vos = await db.vendorOrder.findMany({ where: { orderId } });
    ngVo = vos.find((v) => v.vendorId === V.ng.id)!.id;
    cnVo = vos.find((v) => v.vendorId === V.cn.id)!.id;
    expect(vos.find((v) => v.id === ngVo)!.settlementCurrency).toBe("NGN");
    expect(vos.find((v) => v.id === cnVo)!.settlementCurrency).toBe("CNY");
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).currency).toBe("NGN");
    await booksBalance();
  });

  it("Test 6: a vendor cannot quote or ship another vendor's sub-order", async () => {
    const pickup = await db.pickupAddress.findFirstOrThrow({ where: { vendorId: V.ng.id } });
    await expect(getShippingQuotes(V.ng.id, cnVo, "sandbox-shipping", pickup.id, { length: 20, width: 15, height: 10 })).rejects.toThrow(/not found/);
  });

  it("Test 7: Nigerian vendor buys a sandbox label; Chinese vendor must file customs for CN→NG", async () => {
    await updateVendorOrderStatus(V.ng.id, ngVo, "PROCESSING", V.ng.ownerId);
    await updateVendorOrderStatus(V.cn.id, cnVo, "PROCESSING", V.cn.ownerId);
    const ngPickup = await db.pickupAddress.findFirstOrThrow({ where: { vendorId: V.ng.id } });
    const q = await getShippingQuotes(V.ng.id, ngVo, "sandbox-shipping", ngPickup.id, { length: 20, width: 15, height: 10 });
    expect(q.rows.length).toBeGreaterThan(0);
    await buyLabel(V.ng.id, q.rows[0].id, V.ng.ownerId);

    const cnPickup = await db.pickupAddress.findFirstOrThrow({ where: { vendorId: V.cn.id } });
    const cq = await getShippingQuotes(V.cn.id, cnVo, "sandbox-shipping", cnPickup.id, { length: 30, width: 20, height: 10 });
    expect(cq.international).toBe(true);
    await expect(buyLabel(V.cn.id, cq.rows[0].id, V.cn.ownerId)).rejects.toThrow(/customs/);
    const s = await buyLabel(V.cn.id, cq.rows[0].id, V.cn.ownerId, { contents: "Phone accessories", declaredValueMinor: 10_000_000n, currency: "NGN", hsCodes: ["8518.30"], incoterm: "DAP", insured: false });
    expect((await db.customsDeclaration.findUniqueOrThrow({ where: { shipmentId: s.id } })).incoterm).toBe("DAP");
  });

  it("Tests 8, 11, 12: carrier delivery on one sub-order doesn't touch the other; duplicate webhooks are ignored", async () => {
    const ship = await db.shipment.findFirstOrThrow({ where: { vendorOrderId: ngVo, providerKey: "sandbox-shipping" } });
    const cb = sandboxTrackingCallback(ship.providerShipmentId!, "DELIVERED", "Signed by Ada");
    expect((await deliver("sandbox-shipping", cb)).body).toBe("ok");
    expect((await deliver("sandbox-shipping", cb)).body).toBe("duplicate");
    expect(await db.shipmentEvent.count({ where: { shipmentId: ship.id, status: "DELIVERED" } })).toBe(1);
    const ng = await db.vendorOrder.findUniqueOrThrow({ where: { id: ngVo } });
    const cn = await db.vendorOrder.findUniqueOrThrow({ where: { id: cnVo } });
    expect(ng.status).toBe("DELIVERED");
    expect(ng.deliveryEvidence).toBe("CARRIER");
    expect(cn.status).toBe("SHIPPED");
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PARTIALLY_FULFILLED");
    // A forged webhook is rejected.
    expect((await ingestWebhook("sandbox-shipping", cb.body.replace("Ada", "Eve"), cb.headers)).status).toBe(401);
  });

  it("settlement needs evidence: carrier-confirmed releases after the hold; a vendor-only claim waits longer", async () => {
    await updateVendorOrderStatus(V.cn.id, cnVo, "DELIVERED", V.cn.ownerId); // vendor claim only
    const in4 = new Date(Date.now() + 4 * 864e5);
    expect(await releaseSettlements(in4, 3)).toBe(1);
    expect((await db.vendorOrder.findUniqueOrThrow({ where: { id: ngVo } })).settledAt).not.toBeNull();
    expect((await db.vendorOrder.findUniqueOrThrow({ where: { id: cnVo } })).settledAt).toBeNull();
    expect(await releaseSettlements(new Date(Date.now() + 15 * 864e5), 3)).toBe(1);
    await booksBalance();
  });

  it("NGN payout: only the provider's confirmation can mark it paid", async () => {
    const avail = (await vendorBalances(db, V.ng.id)).available;
    expect(avail).toBe(5_000_000n - 500_000n + 200_000n);
    const p = await requestPayout(V.ng.id, avail, V.ng.ownerId, "ng-1");
    expect((await approveAndInitiatePayout(p.id, adminId)).status).toBe("PROCESSING");
    await expect(markPayoutPaid(p.id, adminId, "FAKE-REF")).rejects.toThrow(FinanceError);
    const cb = sandboxPayoutCallback("sandbox-payouts", payoutReference(p.id), "SUCCESS");
    await deliver("sandbox-payouts", cb);
    expect((await deliver("sandbox-payouts", cb)).body).toBe("duplicate");
    const paid = await db.payout.findUniqueOrThrow({ where: { id: p.id } });
    expect(paid.status).toBe("PAID");
    expect((await vendorBalances(db, V.ng.id)).payoutHold).toBe(0n);
    await booksBalance();
  });

  it("Tests 4 & 10: CNY cross-border payout records the FX quote; a failed payout returns funds and raises an alert", async () => {
    const avail = (await vendorBalances(db, V.cn.id)).available;
    const p1 = await requestPayout(V.cn.id, avail, V.cn.ownerId, "cn-1");
    expect(p1.method).toBe("CROSS_BORDER");
    await approveAndInitiatePayout(p1.id, adminId);
    const q = await db.fxQuote.findUniqueOrThrow({ where: { payoutId: p1.id } });
    expect(q.sourceCurrency).toBe("NGN");
    expect(q.targetCurrency).toBe("CNY");
    expect(q.rate.toString()).toBe("0.0046");
    // ₦100,000 − 10% commission + ₦2,000 shipping = ₦92,000; fee 1% = ₦920; ₦91,080 × 0.0046 = ¥418.968 → ¥418.96 (rounded down)
    expect(avail).toBe(9_200_000n);
    expect(q.feeMinor).toBe(92_000n);
    expect(q.targetAmountMinor).toBe(41_896n);
    await deliver("sandbox-crossborder", sandboxPayoutCallback("sandbox-crossborder", payoutReference(p1.id), "FAILED", "Beneficiary account closed"));
    const failed = await db.payout.findUniqueOrThrow({ where: { id: p1.id }, include: { events: true } });
    expect(failed.status).toBe("FAILED");
    expect(failed.failureReason).toMatch(/closed/);
    expect((await vendorBalances(db, V.cn.id)).available).toBe(avail);
    expect(await db.adminAlert.count({ where: { dedupeKey: `payout-failed:${p1.id}`, resolvedAt: null } })).toBe(1);

    const p2 = await requestPayout(V.cn.id, avail, V.cn.ownerId, "cn-2");
    await approveAndInitiatePayout(p2.id, adminId);
    await deliver("sandbox-crossborder", sandboxPayoutCallback("sandbox-crossborder", payoutReference(p2.id), "SUCCESS"));
    const ok = await db.payout.findUniqueOrThrow({ where: { id: p2.id } });
    expect(ok.status).toBe("PAID");
    expect(ok.settlementCurrency).toBe("CNY");
    expect(ok.settlementAmountMinor).toBe(41_896n);
    await booksBalance();
  });

  it("disputes block settlement until decided", async () => {
    await addToCart(db, { userId: buyerId }, V.ng.productId, 1);
    const { order, reference } = await placeOrder({ ident: { userId: buyerId }, email: "buyer@intl.test", address, shippingChoice: {} });
    await db.payment.update({ where: { reference }, data: { providerPayload: { sandboxOutcome: "approve" } } });
    await confirmPayment(reference);
    const vo = await db.vendorOrder.findFirstOrThrow({ where: { orderId: order.id } });
    for (const s of ["PROCESSING", "READY_FOR_DISPATCH", "SHIPPED"] as const) await updateVendorOrderStatus(V.ng.id, vo.id, s, V.ng.ownerId);
    await confirmReceipt(buyerId, vo.id);
    const d = await openDispute(buyerId, vo.id, "Item not as described", "The colour and size are different from the listing photos.");
    expect(await releaseSettlements(new Date(Date.now() + 30 * 864e5), 3)).toBe(0);
    await decideDispute(d.id, adminId, "REFUND_CUSTOMER", "Photos provided by the customer show a different item.");
    expect((await db.vendorOrder.findUniqueOrThrow({ where: { id: vo.id } })).status).toBe("REFUNDED");
    await booksBalance();
  });
});

describe("manual bank-transfer accounts", () => {
  it("stay pending until finance verifies them, and only then become the default", async () => {
    const { reviewManualBeneficiary } = await import("@/server/services/payouts");
    const owner = await user("manual-vendor@intl.test");
    const v = await db.vendor.create({ data: { ownerId: owner.id, type: "INDIVIDUAL", status: "APPROVED", businessName: "Manual Co", email: owner.email, phone: "08030000009", country: "NG" } });
    const r = await addBeneficiary(v.id, owner.id, "manual", { country: "NG", currency: "NGN", routingType: "NUBAN", accountHolderName: "Manual Co", bankName: "GTBank", bankCode: "058", accountNumber: "0123456789" });
    expect(r.beneficiary.status).toBe("PENDING_VERIFICATION");
    expect(r.beneficiary.detailsEnc).toBeTruthy(); // encrypted, never plaintext
    expect(r.beneficiary.detailsEnc).not.toContain("0123456789");
    await expect(requestPayout(v.id, 1n, owner.id, "manual-k1")).rejects.toThrow(FinanceError);
    await expect(reviewManualBeneficiary(r.beneficiary.id, adminId, "REJECTED", "")).rejects.toThrow(FinanceError);
    await reviewManualBeneficiary(r.beneficiary.id, adminId, "VERIFIED", "MANUAL CO (confirmed by bank)");
    const b = await db.beneficiary.findUniqueOrThrow({ where: { id: r.beneficiary.id } });
    expect(b.status).toBe("VERIFIED");
    expect(b.isDefault).toBe(true);
    await expect(reviewManualBeneficiary(b.id, adminId, "VERIFIED", "again")).rejects.toThrow(FinanceError);
  });
});
