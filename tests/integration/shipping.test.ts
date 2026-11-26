/**
 * Shipping & logistics against a real database. Carrier calls use the built-in sandbox carrier (no external network);
 * DHL is exercised with a stubbed fetch returning the documented MyDHL response shape.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { syncRbac } from "../../prisma/rbac-sync";
import { seedIntegrations } from "../../prisma/seed-lib";
import { hashPassword } from "@/server/auth/password";
import { addToCart, getOrCreateCart } from "@/server/services/cart";
import { confirmPayment, placeOrder, updateVendorOrderStatus } from "@/server/services/orders";
import { releaseSettlements } from "@/server/services/finance";
import { checkoutCarrierOptions, quoteKey, type CheckoutLine } from "@/server/services/shipping-rates";
import { buyLabel, cancelShipment, getShippingQuotes, refreshTracking, schedulePickup } from "@/server/services/shipping";
import { addToConsolidation, advanceConsolidation, confirmFinalDelivery, createConsolidation, dispatchLastMile, receiveParcel, recordPartnerQuote, registerInbound, saveWarehouse } from "@/server/services/freight";
import { decideReturn, markReturnShipped, receiveReturnAndRefund, requestReturn } from "@/server/services/shipping-returns";
import { sandboxShipping } from "@/server/integrations/shipping/sandbox";
import { dhlExpress } from "@/server/integrations/shipping/dhl";

process.env.ENCRYPTION_KEY ??= "1".repeat(64);
const address = { fullName: "Chi Buyer", phone: "08030000009", line1: "5 Allen Avenue", city: "Ikeja", state: "Lagos", country: "NG" };
let adminId: string, buyerId: string, otherBuyerId: string;
const V: Record<"a" | "b" | "cn", { id: string; ownerId: string; productId: string }> = {} as never;

async function user(email: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: "CUSTOMER" } });
  return db.user.create({ data: { email, name: email.split("@")[0], passwordHash: await hashPassword("Password123!"), emailVerifiedAt: new Date(), roles: { create: { roleId: role.id } } } });
}
async function vendor(tag: "a" | "b" | "cn", country: string, currency: string) {
  const owner = await user(`ship-${tag}@ship.test`);
  const cat = await db.category.upsert({ where: { slug: "ship-cat" }, update: {}, create: { slug: "ship-cat", name: "Ship", kind: "PRODUCT" } });
  const v = await db.vendor.create({
    data: {
      ownerId: owner.id, type: "BUSINESS", status: "APPROVED", businessName: `Ship ${tag.toUpperCase()}`, email: owner.email, phone: "+2348030000000", country, payoutCurrency: currency,
      city: country === "CN" ? "Guangzhou" : "Ikeja", state: country === "CN" ? null : "Lagos", region: country === "CN" ? "Guangdong" : null,
      store: { create: { slug: `ship-${tag}`, name: `Ship ${tag}` } },
      shippingMethods: { create: { name: "Seller delivery", type: "FLAT", rateMinor: 150_000n, destinationCountries: ["NG"] } },
      pickupAddresses: { create: { label: "Store", contactName: "Dispatch", phone: "+2348030000000", email: owner.email, line1: "1 Shop Rd", city: country === "CN" ? "Guangzhou" : "Ikeja", region: country === "CN" ? "Guangdong" : "Lagos", country, isDefault: true } },
    },
  });
  await db.userRole.create({ data: { userId: owner.id, roleId: (await db.role.findUniqueOrThrow({ where: { key: "VENDOR" } })).id, vendorId: v.id } });
  const p = await db.product.create({ data: { vendorId: v.id, categoryId: cat.id, name: `Ship ${tag} item`, slug: `ship-${tag}-item`, description: "Test", priceMinor: 2_000_000n, stockQuantity: 50, weightGrams: 1200, lengthCm: 30, widthCm: 20, heightCm: 10, status: "PUBLISHED" } });
  V[tag] = { id: v.id, ownerId: owner.id, productId: p.id };
}
async function paidOrder(buyer: string, shippingChoice: Record<string, string> = {}, addr = address) {
  const { order, reference } = await placeOrder({ ident: { userId: buyer }, email: "buyer@ship.test", address: addr, shippingChoice });
  await db.payment.update({ where: { reference }, data: { providerPayload: { sandboxOutcome: "approve" } } });
  expect((await confirmPayment(reference)).outcome).toBe("paid");
  return db.vendorOrder.findMany({ where: { orderId: order.id } });
}
const lineFor = async (productId: string, quantity = 1): Promise<CheckoutLine> => {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId } });
  return { productId, quantity, name: p.name, unitPriceMinor: p.priceMinor, weightGrams: p.weightGrams, lengthCm: p.lengthCm, widthCm: p.widthCm, heightCm: p.heightCm };
};

beforeAll(async () => {
  await syncRbac(db);
  await seedIntegrations(db);
  if (!(await db.commissionRule.count({ where: { scope: "GLOBAL" } }))) await db.commissionRule.create({ data: { scope: "GLOBAL", name: "Default", rateBps: 1000 } });
  await db.integrationProvider.update({ where: { key: "sandbox-shipping" }, data: { active: true, feeBps: 1000, feeFixedMinor: 0n } });
  adminId = (await user("admin@ship.test")).id;
  buyerId = (await user("buyer@ship.test")).id;
  otherBuyerId = (await user("other@ship.test")).id;
  await vendor("a", "NG", "NGN");
  await vendor("b", "NG", "NGN");
  await vendor("cn", "CN", "CNY");
});
afterEach(() => { vi.unstubAllGlobals(); delete (sandboxShipping as { getTracking?: unknown }).getTracking; });

describe("checkout courier options per vendor sub-order", () => {
  let voA: string, voB: string;

  it("quotes each seller separately with the admin markup and binds the chosen quote to its sub-order", async () => {
    await addToCart(db, { userId: buyerId }, V.a.productId, 1);
    await addToCart(db, { userId: buyerId }, V.b.productId, 2);
    const cart = await getOrCreateCart(db, { userId: buyerId });
    const byVendor = { [V.a.id]: [await lineFor(V.a.productId)], [V.b.id]: [await lineFor(V.b.productId, 2)] };
    const opts = await checkoutCarrierOptions(cart.id, address, byVendor);
    expect(opts[V.a.id].options.length).toBeGreaterThan(0);
    expect(opts[V.b.id].options.length).toBeGreaterThan(0);
    const qa = await db.shippingQuote.findUniqueOrThrow({ where: { id: opts[V.a.id].options[0].id.slice(2) } });
    expect(qa.costMinor).not.toBeNull();
    expect(qa.amountMinor).toBe(qa.costMinor! + qa.costMinor! / 10n);
    expect(qa.markupMinor).toBe(qa.costMinor! / 10n);
    expect(qa.addressHash).toBe(quoteKey(address, byVendor[V.a.id]));
    // A second call for the same cart/address reuses the stored quotes instead of re-quoting.
    const again = await checkoutCarrierOptions(cart.id, address, byVendor);
    expect(again[V.a.id].options.map((o) => o.id).sort()).toEqual(opts[V.a.id].options.map((o) => o.id).sort());

    // A different address invalidates the quote at order time.
    await expect(placeOrder({ ident: { userId: buyerId }, email: "buyer@ship.test", address: { ...address, line1: "9 Other Street" }, shippingChoice: { [V.a.id]: opts[V.a.id].options[0].id, [V.b.id]: opts[V.b.id].options[0].id } })).rejects.toThrow(/courier price/);

    const vos = await paidOrder(buyerId, { [V.a.id]: opts[V.a.id].options[0].id, [V.b.id]: opts[V.b.id].options[0].id });
    expect(vos).toHaveLength(2); // never combined across sellers
    const a = vos.find((v) => v.vendorId === V.a.id)!;
    const b = vos.find((v) => v.vendorId === V.b.id)!;
    voA = a.id; voB = b.id;
    expect(a.shippingQuoteId).toBe(qa.id);
    expect(a.shippingMinor).toBe(qa.amountMinor);
    expect(a.shippingMethodId).toBeNull();
    expect((await db.shippingQuote.findUniqueOrThrow({ where: { id: qa.id } })).vendorOrderId).toBe(a.id);
    expect(b.shippingQuoteId).not.toBe(a.shippingQuoteId);
  });

  it("a double-submitted booking buys exactly one label", async () => {
    await updateVendorOrderStatus(V.a.id, voA, "PROCESSING", V.a.ownerId);
    const a = await db.vendorOrder.findUniqueOrThrow({ where: { id: voA } });
    const results = await Promise.allSettled([buyLabel(V.a.id, a.shippingQuoteId!, V.a.ownerId), buyLabel(V.a.id, a.shippingQuoteId!, V.a.ownerId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const ships = await db.shipment.findMany({ where: { vendorOrderId: voA, providerKey: "sandbox-shipping" }, include: { items: true } });
    expect(ships).toHaveLength(1);
    expect(ships[0].status).toBe("AWAITING_PICKUP");
    expect(ships[0].items).toHaveLength(1);
    expect((await db.vendorOrder.findUniqueOrThrow({ where: { id: voA } })).status).toBe("SHIPPED");
  });

  it("vendors cannot touch each other's shipments; cancellation reopens the sub-order", async () => {
    const s = await db.shipment.findFirstOrThrow({ where: { vendorOrderId: voA, providerKey: "sandbox-shipping" } });
    await expect(cancelShipment({ id: V.b.ownerId, vendorId: V.b.id }, s.id, "not mine")).rejects.toThrow(/not found/);
    await expect(schedulePickup(V.b.id, s.id, new Date().toISOString().slice(0, 10), V.b.ownerId)).rejects.toThrow(/not found/);
    const pickupB = await db.pickupAddress.findFirstOrThrow({ where: { vendorId: V.b.id } });
    await expect(getShippingQuotes(V.b.id, voA, "sandbox-shipping", pickupB.id, { length: 10, width: 10, height: 10 })).rejects.toThrow(/not found/);
    await cancelShipment({ id: V.a.ownerId, vendorId: V.a.id }, s.id, "Customer asked to change size");
    const after = await db.shipment.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.status).toBe("CANCELLED");
    expect(after.idempotencyKey).toBeNull();
    expect((await db.vendorOrder.findUniqueOrThrow({ where: { id: voA } })).status).toBe("PROCESSING");
    await expect(cancelShipment({ id: adminId, staff: true }, s.id, "again")).rejects.toThrow(/picked up/);
  });

  it("polled tracking changes status only for mapped carrier statuses", async () => {
    await updateVendorOrderStatus(V.b.id, voB, "PROCESSING", V.b.ownerId);
    const b = await db.vendorOrder.findUniqueOrThrow({ where: { id: voB } });
    const s = await buyLabel(V.b.id, b.shippingQuoteId!, V.b.ownerId);
    const at = new Date();
    (sandboxShipping as { getTracking?: unknown }).getTracking = async () => ({ status: null, rawStatus: "mystery", trackingUrl: null, events: [{ at, description: "Scanned somewhere", location: "Lagos" }] });
    const r1 = await refreshTracking(s.id);
    expect(r1).toMatchObject({ added: 1, status: null });
    expect((await db.shipment.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("AWAITING_PICKUP");
    expect((await refreshTracking(s.id)).added).toBe(0); // deduped
    (sandboxShipping as { getTracking?: unknown }).getTracking = async () => ({ status: "IN_TRANSIT", rawStatus: "in_transit", trackingUrl: null, events: [{ at: new Date(at.getTime() + 1000), description: "Departed hub", location: "Lagos" }] });
    expect((await refreshTracking(s.id)).status).toBe("IN_TRANSIT");
    expect((await db.shipment.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("IN_TRANSIT");
  });
});

describe("China → Nigeria consolidated freight", () => {
  it("runs warehouse receipt → consolidation → customs → last mile → delivered with ADMIN evidence", async () => {
    await addToCart(db, { userId: otherBuyerId }, V.cn.productId, 1);
    const [vo] = await paidOrder(otherBuyerId);
    await updateVendorOrderStatus(V.cn.id, vo.id, "PROCESSING", V.cn.ownerId);
    const wh = await saveWarehouse(adminId, { code: "CN-GZ-T", name: "Guangzhou test warehouse", country: "CN", city: "Guangzhou", address: "Baiyun District", partnerKey: "skyways", role: "ORIGIN", active: true });
    const ngWh = await saveWarehouse(adminId, { code: "NG-LOS-T", name: "Lagos hub", country: "NG", city: "Lagos", address: "Ikeja", role: "ORIGIN", active: true });
    await expect(registerInbound(V.cn.id, V.cn.ownerId, { vendorOrderId: vo.id, warehouseId: ngWh.id })).rejects.toThrow(/ships from CN/);
    await expect(registerInbound(V.a.id, V.a.ownerId, { vendorOrderId: vo.id, warehouseId: wh.id })).rejects.toThrow(/not found/);
    const receipt = await registerInbound(V.cn.id, V.cn.ownerId, { vendorOrderId: vo.id, warehouseId: wh.id, carrier: "SF Express", tracking: "SF123" });
    expect((await db.vendorOrder.findUniqueOrThrow({ where: { id: vo.id } })).status).toBe("SHIPPED");

    await receiveParcel(adminId, receipt.id, { weightGrams: 1300, lengthCm: 32, widthCm: 22, heightCm: 12, pieces: 1 });
    const c = await createConsolidation(adminId, { mode: "AIR", partnerKey: "skyways", originWarehouseId: wh.id });
    await expect(advanceConsolidation(adminId, c.id, "DEPARTED")).rejects.toThrow(/Next step/);
    await expect(advanceConsolidation(adminId, c.id, "BOOKED", { partnerReference: "AWB-1" })).rejects.toThrow(/Add parcels/);
    expect(await addToConsolidation(adminId, c.id, [receipt.id])).toBe(1);
    await expect(recordPartnerQuote(adminId, c.id, { costMinor: 4_500_000n, currency: "NGN", includes: "freight", excludes: "" })).rejects.toThrow();
    await recordPartnerQuote(adminId, c.id, { costMinor: 4_500_000n, currency: "NGN", includes: "air freight, clearance", excludes: "Import duty and VAT" });
    await advanceConsolidation(adminId, c.id, "BOOKED", { partnerReference: "AWB-1" });
    for (const step of ["DEPARTED", "ARRIVED", "CUSTOMS"] as const) await advanceConsolidation(adminId, c.id, step);
    const leg = await db.shipment.findFirstOrThrow({ where: { vendorOrderId: vo.id, leg: "CONSOLIDATED" } });
    expect(leg.status).toBe("CUSTOMS_PROCESSING");
    expect(leg.trackingNumber).toBe("AWB-1");
    await expect(dispatchLastMile(adminId, leg.id, { carrier: "Rider Co" })).rejects.toThrow(/cleared customs/);
    await advanceConsolidation(adminId, c.id, "CLEARED");
    await advanceConsolidation(adminId, c.id, "LAST_MILE");
    await dispatchLastMile(adminId, leg.id, { carrier: "Rider Co", trackingNumber: "RC-9" });
    const lm = await db.shipment.findFirstOrThrow({ where: { vendorOrderId: vo.id, leg: "LAST_MILE" } });
    await confirmFinalDelivery(adminId, lm.id, "Chi");
    const done = await db.vendorOrder.findUniqueOrThrow({ where: { id: vo.id } });
    expect(done.status).toBe("DELIVERED");
    expect(done.deliveryEvidence).toBe("ADMIN");
    expect((await db.freightConsolidation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("CLOSED");
    expect(await db.notification.count({ where: { userId: otherBuyerId, link: "/account/shipments" } })).toBeGreaterThan(0);
  });
});

describe("returns", () => {
  it("an open return pauses settlement; receiving it refunds the customer", async () => {
    await addToCart(db, { userId: buyerId }, V.a.productId, 1);
    const [vo] = await paidOrder(buyerId);
    await updateVendorOrderStatus(V.a.id, vo.id, "PROCESSING", V.a.ownerId);
    await expect(requestReturn(buyerId, vo.id, "Damaged on arrival", "")).rejects.toThrow(/delivered/);
    await updateVendorOrderStatus(V.a.id, vo.id, "READY_FOR_DISPATCH", V.a.ownerId);
    await updateVendorOrderStatus(V.a.id, vo.id, "SHIPPED", V.a.ownerId);
    await db.vendorOrder.update({ where: { id: vo.id }, data: { status: "DELIVERED", deliveredAt: new Date(), deliveryEvidence: "CARRIER" } });
    await expect(requestReturn(otherBuyerId, vo.id, "Damaged on arrival", "")).rejects.toThrow(/not found/);
    const r = await requestReturn(buyerId, vo.id, "Damaged on arrival", "Screen cracked");
    await expect(requestReturn(buyerId, vo.id, "Other", "")).rejects.toThrow(/already/);
    expect(await releaseSettlements(new Date(Date.now() + 30 * 864e5), 3)).toBeGreaterThanOrEqual(0);
    expect((await db.vendorOrder.findUniqueOrThrow({ where: { id: vo.id } })).settledAt).toBeNull();
    await expect(decideReturn({ id: V.b.ownerId, vendorId: V.b.id }, r.id, true, "")).rejects.toThrow(/not found/);
    await decideReturn({ id: V.a.ownerId, vendorId: V.a.id }, r.id, true, "Send to 1 Shop Rd, Ikeja");
    await markReturnShipped(buyerId, r.id, "GIG", "GIG-RET-1");
    await receiveReturnAndRefund({ id: V.a.ownerId, vendorId: V.a.id }, r.id, "Received cracked as described");
    expect((await db.shippingReturn.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("REFUNDED");
    expect(["REFUNDED", "PARTIALLY_REFUNDED"]).toContain((await db.vendorOrder.findUniqueOrThrow({ where: { id: vo.id } })).status);
  });
});

describe("DHL Express adapter", () => {
  it("maps the documented /rates response (BILLC price, transit days) and sends the required headers", async () => {
    let seen: { url: string; headers: Headers } | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen = { url, headers: new Headers(init.headers) };
      return new Response(JSON.stringify({ products: [{ productName: "EXPRESS WORLDWIDE", productCode: "P", totalPrice: [{ currencyType: "BILLC", priceCurrency: "USD", price: 98.25 }, { currencyType: "PULCL", priceCurrency: "CNY", price: 700 }], deliveryCapabilities: { estimatedDeliveryDateAndTime: "2026-12-02T23:59:00", totalTransitDays: 4 } }] }), { status: 200 });
    });
    const res = await dhlExpress.getRates!({ key: "dhl-express", mode: "SANDBOX", credentials: { apiKey: "k", apiSecret: "s", accountNumber: "123456789" } }, {
      origin: { name: "S", phone: "1", email: "s@x.test", line1: "1", city: "Guangzhou", region: "Guangdong", country: "CN" },
      destination: { name: "B", phone: "2", email: "b@x.test", line1: "2", city: "Lagos", region: "Lagos", country: "NG" },
      items: [{ name: "x", description: "x", unitValueMinor: 1n, quantity: 2, weightGrams: 600 }], dimensionsCm: { length: 30, width: 20, height: 10 }, pickupDate: "2026-11-28", currency: "NGN",
    });
    expect(seen!.url).toContain("/mydhlapi/test/rates?");
    expect(seen!.url).toContain("weight=1.200");
    expect(seen!.headers.get("x-version")).toBe("3.4.1");
    expect(seen!.headers.get("authorization")).toBe(`Basic ${Buffer.from("k:s").toString("base64")}`);
    expect(res.rates).toHaveLength(1);
    expect(res.rates[0]).toMatchObject({ amountMinor: 9825n, currency: "USD", etaDaysMax: 4, courierName: "DHL EXPRESS WORLDWIDE" });
  });
});
