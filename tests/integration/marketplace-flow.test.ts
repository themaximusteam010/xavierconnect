/**
 * End-to-end service-level test of Workflows A, C, D and E against a real PostgreSQL database:
 * vendor approval → multi-vendor checkout → sandbox payment → split orders → fulfilment →
 * settlement → payout → refund, checking the ledger after every step.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { syncRbac } from "../../prisma/rbac-sync";
import { hashPassword } from "@/server/auth/password";
import { addToCart, loadCartView } from "@/server/services/cart";
import { confirmPayment, expireUnpaidOrders, placeOrder, updateVendorOrderStatus } from "@/server/services/orders";
import { failPayout, markPayoutPaid, refundVendorOrder, releaseSettlements, requestPayout, trialBalance } from "@/server/services/finance";
import { reviewApplication, startApplication, submitApplication, VENDOR_AGREEMENT_VERSION } from "@/server/services/vendors";
import { moderateProduct, submitProductForReview } from "@/server/services/catalog";
import { accountBalance, PlatformAccounts, vendorBalances } from "@/server/domain/ledger";
import { confirmReceipt } from "@/server/services/disputes";

const address = { fullName: "Test Buyer", phone: "08030000000", line1: "1 Test Street", city: "Ikeja", state: "Lagos", country: "NG" };
let adminId: string;
let customerId: string;
const vendors: { id: string; ownerId: string; productId: string }[] = [];

async function makeUser(email: string, verified = true) {
  const u = await db.user.create({
    data: { email, name: email.split("@")[0], passwordHash: await hashPassword("Password123!"), emailVerifiedAt: verified ? new Date() : null },
  });
  const customer = await db.role.findUniqueOrThrow({ where: { key: "CUSTOMER" } });
  await db.userRole.create({ data: { userId: u.id, roleId: customer.id } });
  return u;
}

async function makeApprovedVendor(n: number, priceMinor: bigint, stock: number) {
  const owner = await makeUser(`vendor${n}@test.local`);
  const v = await startApplication(owner.id, "BUSINESS");
  await db.vendor.update({
    where: { id: v.id },
    data: {
      businessName: `Test Vendor ${n}`, description: "Test vendor", businessCategory: "Electronics", addressLine1: "1 Road", city: "Ikeja", state: "Lagos",
      agreementAcceptedAt: new Date(), agreementVersion: VENDOR_AGREEMENT_VERSION,
      store: { create: { slug: `test-vendor-${n}`, name: `Test Vendor ${n}` } },
      documents: { create: { type: "GOVERNMENT_ID", fileKey: `private/test/${n}.pdf`, fileName: "id.pdf" } },
      shippingMethods: { create: { name: "Flat rate", type: "FLAT", rateMinor: 150_000n } },
      payoutAccount: { create: { bankName: "Test Bank", bankCode: "000", accountName: `Vendor ${n}`, accountNumberLast4: "1234", verifiedAt: new Date() } },
    },
  });
  await submitApplication(v.id, owner.id);
  await reviewApplication(v.id, adminId, "APPROVE", null);
  // Finance pays this vendor by manual bank transfer (no payout API) — the only path where staff record "paid".
  await db.beneficiary.create({ data: { vendorId: v.id, providerKey: "manual", country: "NG", currency: "NGN", routingType: "NUBAN", bankName: "Test Bank", bankCode: "000", accountHolderName: `Vendor ${n}`, accountLast4: "1234", status: "VERIFIED", isDefault: true, verifiedAt: new Date() } });

  const cat = await db.category.upsert({ where: { slug: "test-cat" }, update: {}, create: { slug: "test-cat", name: "Test", kind: "PRODUCT" } });
  const p = await db.product.create({
    data: {
      vendorId: v.id, categoryId: cat.id, name: `Widget ${n}`, slug: `widget-${n}`, description: "A widget", priceMinor, stockQuantity: stock, weightGrams: 500,
      images: { create: { url: "/test.jpg", alt: "Widget" } },
    },
  });
  await submitProductForReview(v.id, p.id, owner.id);
  await moderateProduct(p.id, adminId, true);
  vendors.push({ id: v.id, ownerId: owner.id, productId: p.id });
}

async function approveSandbox(reference: string) {
  await db.payment.update({ where: { reference }, data: { providerPayload: { sandboxOutcome: "approve" } } });
}

async function assertBooksBalance() {
  const rows = await trialBalance();
  const d = rows.reduce((a, r) => a + r.debit, 0n);
  const c = rows.reduce((a, r) => a + r.credit, 0n);
  expect(d).toBe(c);
}

beforeAll(async () => {
  await syncRbac(db);
  await db.commissionRule.create({ data: { scope: "GLOBAL", name: "Default 10%", rateBps: 1000 } });
  const admin = await makeUser("admin@test.local");
  await db.userRole.create({ data: { userId: admin.id, roleId: (await db.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } })).id } });
  adminId = admin.id;
  customerId = (await makeUser("buyer@test.local")).id;
  await makeApprovedVendor(1, 10_000_000n, 5); // ₦100,000
  await makeApprovedVendor(2, 2_500_000n, 3); // ₦25,000
});

describe("Workflow A: vendor onboarding", () => {
  it("approved vendor owner receives a vendor-scoped role", async () => {
    const roles = await db.userRole.findMany({ where: { userId: vendors[0].ownerId }, include: { role: true } });
    expect(roles.map((r) => r.role.key)).toContain("VENDOR");
    expect(roles.find((r) => r.role.key === "VENDOR")?.vendorId).toBe(vendors[0].id);
  });
  it("unverified users cannot apply", async () => {
    const u = await makeUser("unverified@test.local", false);
    await expect(startApplication(u.id, "INDIVIDUAL")).rejects.toThrow(/Verify your email/);
  });
});

describe("Workflows C–E: multi-vendor purchase, settlement, payout, refund", () => {
  let orderId: string;
  let reference: string;

  it("prices a two-vendor cart and places one parent order with two sub-orders", async () => {
    await addToCart(db, { userId: customerId }, vendors[0].productId, 1);
    await addToCart(db, { userId: customerId }, vendors[1].productId, 2);
    const view = await loadCartView(db, { userId: customerId });
    expect(view!.pricing.vendors).toHaveLength(2);
    expect(view!.pricing.totalMinor).toBe(10_000_000n + 5_000_000n + 300_000n);

    const res = await placeOrder({ ident: { userId: customerId }, email: "buyer@test.local", address, shippingChoice: {} });
    orderId = res.order.id;
    reference = res.reference;
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { vendorOrders: true } });
    expect(order.number).toMatch(/^XC-\d+$/);
    expect(order.vendorOrders.map((v) => v.number).sort()).toEqual([`${order.number}-A`, `${order.number}-B`]);
    expect(order.status).toBe("PENDING_PAYMENT");
    // stock reserved
    expect((await db.product.findUniqueOrThrow({ where: { id: vendors[1].productId } })).stockQuantity).toBe(1);
    // cart emptied
    expect(await db.cartItem.count({ where: { cart: { userId: customerId } } })).toBe(0);
  });

  it("refuses to oversell", async () => {
    await expect(addToCart(db, { userId: customerId }, vendors[1].productId, 2)).rejects.toThrow(/Only 1 left/);
  });

  it("payment confirmation is idempotent and posts one balanced capture", async () => {
    expect((await confirmPayment(reference)).outcome).toBe("pending");
    await approveSandbox(reference);
    const results = await Promise.all([confirmPayment(reference), confirmPayment(reference), confirmPayment(reference)]);
    expect(results.filter((r) => r.outcome === "paid")).toHaveLength(1);
    const number = (await db.order.findUniqueOrThrow({ where: { id: orderId } })).number;
    expect(await db.ledgerTransaction.count({ where: { kind: "PAYMENT_CAPTURED", reference: number } })).toBe(1);

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { vendorOrders: true } });
    expect(order.paymentStatus).toBe("PAID");
    expect(order.vendorOrders.every((v) => v.status === "NEW")).toBe(true);

    const a = await vendorBalances(db, vendors[0].id);
    expect(a.pending).toBe(10_000_000n - 1_000_000n + 150_000n); // spec example: ₦100k − 10% + shipping
    expect(a.available).toBe(0n);
    const capture = await db.ledgerTransaction.findFirstOrThrow({ where: { kind: "PAYMENT_CAPTURED", reference: order.number }, include: { entries: { include: { account: true } } } });
    expect(capture.entries.find((e) => e.account.code === PlatformAccounts.commission.code)?.creditMinor).toBe(1_000_000n + 500_000n);
    expect(capture.entries.find((e) => e.account.code === PlatformAccounts.clearing.code)?.debitMinor).toBe(order.totalMinor);
    void accountBalance;
    await assertBooksBalance();
  });

  it("each vendor can only fulfil its own sub-order", async () => {
    const [voA, voB] = await db.vendorOrder.findMany({ where: { orderId }, orderBy: { number: "asc" } });
    expect(voA.vendorId).toBe(vendors[0].id);
    await expect(updateVendorOrderStatus(vendors[1].id, voA.id, "PROCESSING", vendors[1].ownerId)).rejects.toThrow(/not found/);
    await expect(updateVendorOrderStatus(vendors[0].id, voA.id, "SHIPPED", vendors[0].ownerId)).rejects.toThrow(/Cannot move/);
    for (const s of ["PROCESSING", "READY_FOR_DISPATCH", "SHIPPED", "DELIVERED"] as const) {
      await updateVendorOrderStatus(vendors[0].id, voA.id, s, vendors[0].ownerId, { trackingNumber: "GIG123" });
    }
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PARTIALLY_FULFILLED");
    expect((await db.vendorOrder.findUniqueOrThrow({ where: { id: voB.id } })).status).toBe("NEW");
  });

  it("releases settlement after the hold period, once (customer-confirmed delivery)", async () => {
    const voA = await db.vendorOrder.findFirstOrThrow({ where: { orderId, vendorId: vendors[0].id } });
    expect(await releaseSettlements(new Date(Date.now() + 4 * 864e5), 3)).toBe(0); // vendor's own claim is not enough after 4 days
    await confirmReceipt(customerId, voA.id);
    expect(await releaseSettlements(new Date(), 3)).toBe(0); // still within hold window
    expect(await releaseSettlements(new Date(Date.now() + 4 * 864e5), 3)).toBe(1);
    expect(await releaseSettlements(new Date(Date.now() + 4 * 864e5), 3)).toBe(0);
    const a = await vendorBalances(db, vendors[0].id);
    expect(a.pending).toBe(0n);
    expect(a.available).toBe(9_150_000n);
    await assertBooksBalance();
  });

  it("payouts: threshold, balance check, idempotency, paid and failed paths", async () => {
    const v = vendors[0].id;
    await expect(requestPayout(v, 100n, vendors[0].ownerId, "k0")).rejects.toThrow(/minimum/);
    await expect(requestPayout(v, 9_150_001n, vendors[0].ownerId, "k1")).rejects.toThrow(/exceeds/);
    const p1 = await requestPayout(v, 5_000_000n, vendors[0].ownerId, "k2");
    const p1again = await requestPayout(v, 5_000_000n, vendors[0].ownerId, "k2");
    expect(p1again.id).toBe(p1.id);
    expect((await vendorBalances(db, v)).available).toBe(4_150_000n);
    await markPayoutPaid(p1.id, adminId, "TRF-001");
    await markPayoutPaid(p1.id, adminId, "TRF-001"); // double click
    expect((await vendorBalances(db, v)).payoutHold).toBe(0n);

    const p2 = await requestPayout(v, 1_000_000n, vendors[0].ownerId, "k3");
    await failPayout(p2.id, adminId, "Bank rejected transfer", "FAILED");
    expect((await vendorBalances(db, v)).available).toBe(4_150_000n);
    await assertBooksBalance();
  });

  it("refunds vendor B's slice and returns stock; order becomes partially refunded", async () => {
    const voB = await db.vendorOrder.findFirstOrThrow({ where: { orderId, vendorId: vendors[1].id } });
    await refundVendorOrder(voB.id, adminId, "Seller could not fulfil");
    await refundVendorOrder(voB.id, adminId, "Seller could not fulfil"); // idempotent
    const b = await vendorBalances(db, vendors[1].id);
    expect(b.pending).toBe(0n);
    expect((await db.product.findUniqueOrThrow({ where: { id: vendors[1].productId } })).stockQuantity).toBe(3);
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("PARTIALLY_REFUNDED");
    expect(await db.refund.count({ where: { vendorOrderId: voB.id, status: "COMPLETED" } })).toBe(1);
    await assertBooksBalance();
  });

  it("ledger rows cannot be edited or deleted", async () => {
    await expect(db.ledgerEntry.updateMany({ data: { debitMinor: 1n }, where: {} })).rejects.toThrow();
    await expect(db.ledgerTransaction.deleteMany({})).rejects.toThrow();
  });
});

describe("reservation expiry", () => {
  it("cancels unpaid orders and returns stock", async () => {
    await addToCart(db, { userId: customerId }, vendors[1].productId, 1);
    const res = await placeOrder({ ident: { userId: customerId }, email: "buyer@test.local", address, shippingChoice: {} });
    expect((await db.product.findUniqueOrThrow({ where: { id: vendors[1].productId } })).stockQuantity).toBe(2);
    expect(await expireUnpaidOrders(new Date(Date.now() + 31 * 60_000))).toBeGreaterThanOrEqual(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: vendors[1].productId } })).stockQuantity).toBe(3);
    expect((await db.order.findUniqueOrThrow({ where: { id: res.order.id } })).status).toBe("CANCELLED");

    // A late successful payment does not resurrect the order; it is queued for refund.
    await approveSandbox(res.reference);
    expect((await confirmPayment(res.reference)).outcome).toBe("needs_review");
    expect(await db.refund.count({ where: { orderId: res.order.id } })).toBe(1);
  });
});
