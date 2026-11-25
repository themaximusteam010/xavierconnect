import { describe, expect, it } from "vitest";
import { priceOrder, type PricingLine } from "@/server/domain/pricing";

const rules = [{ id: "g", scope: "GLOBAL" as const, rateBps: 1000, fixedMinor: 0n, active: true }];
const line = (o: Partial<PricingLine> & Pick<PricingLine, "key" | "vendorId">): PricingLine => ({
  productId: o.key, categoryId: "c", kind: "PHYSICAL", unitPriceMinor: 1_000_000n, quantity: 1, weightGrams: 500, ...o,
});
const flat = (rate: bigint, freeOver: bigint | null = null) => ({ id: "s", type: "FLAT" as const, rateMinor: rate, perKgMinor: 0n, freeOverMinor: freeOver });

describe("multi-vendor pricing", () => {
  it("splits into vendor slices that sum to the order total", () => {
    const res = priceOrder({
      lines: [
        line({ key: "a1", vendorId: "A", unitPriceMinor: 10_000_000n }),
        line({ key: "b1", vendorId: "B", unitPriceMinor: 2_500_000n, quantity: 2 }),
        line({ key: "c1", vendorId: "C", kind: "DIGITAL", unitPriceMinor: 500_000n }),
      ],
      rules,
      shippingByVendor: { A: flat(250_000n), B: flat(150_000n), C: flat(999n) },
    });
    expect(res.vendors).toHaveLength(3);
    const [a, b, c] = res.vendors;
    expect(a.commissionMinor).toBe(1_000_000n);
    expect(a.vendorNetMinor).toBe(10_000_000n - 1_000_000n + 250_000n);
    expect(b.subtotalMinor).toBe(5_000_000n);
    expect(c.shippingMinor).toBe(0n); // digital-only slice has no shipping
    expect(res.totalMinor).toBe(a.totalMinor + b.totalMinor + c.totalMinor);
    expect(res.totalMinor).toBe(10_000_000n + 5_000_000n + 500_000n + 250_000n + 150_000n);
  });

  it("vendor coupon is vendor-funded and reduces commission base", () => {
    const res = priceOrder({
      lines: [line({ key: "a1", vendorId: "A", unitPriceMinor: 10_000_000n }), line({ key: "b1", vendorId: "B" })],
      rules,
      shippingByVendor: {},
      coupon: { code: "A10", vendorId: "A", type: "PERCENT", value: 1000, minSubtotalMinor: 0n, maxDiscountMinor: null },
    });
    const a = res.vendors[0];
    expect(a.vendorDiscountMinor).toBe(1_000_000n);
    expect(a.commissionMinor).toBe(900_000n);
    expect(a.vendorNetMinor).toBe(9_000_000n - 900_000n);
    expect(res.vendors[1].vendorDiscountMinor).toBe(0n);
  });

  it("platform coupon is platform-funded: vendor net unchanged, customer pays less", () => {
    const base = priceOrder({ lines: [line({ key: "a", vendorId: "A" }), line({ key: "b", vendorId: "B" })], rules, shippingByVendor: {} });
    const res = priceOrder({
      lines: [line({ key: "a", vendorId: "A" }), line({ key: "b", vendorId: "B" })],
      rules,
      shippingByVendor: {},
      coupon: { code: "XC5K", vendorId: null, type: "FIXED", value: 500_001, minSubtotalMinor: 0n, maxDiscountMinor: null },
    });
    expect(res.discountMinor).toBe(500_001n);
    expect(res.totalMinor).toBe(base.totalMinor - 500_001n);
    expect(res.vendors.map((v) => v.vendorNetMinor)).toEqual(base.vendors.map((v) => v.vendorNetMinor));
    expect(res.vendors[0].platformDiscountMinor + res.vendors[1].platformDiscountMinor).toBe(500_001n);
  });

  it("respects minimum spend and free-shipping threshold", () => {
    const res = priceOrder({
      lines: [line({ key: "a", vendorId: "A", unitPriceMinor: 2_000_000n })],
      rules,
      shippingByVendor: { A: flat(200_000n, 2_000_000n) },
      coupon: { code: "BIG", vendorId: null, type: "PERCENT", value: 1000, minSubtotalMinor: 5_000_000n, maxDiscountMinor: null },
    });
    expect(res.couponApplied).toBe(false);
    expect(res.couponMessage).toMatch(/minimum/);
    expect(res.shippingMinor).toBe(0n);
  });

  it("weight-based shipping rounds up to whole kg", () => {
    const res = priceOrder({
      lines: [line({ key: "a", vendorId: "A", weightGrams: 1200, quantity: 2 })],
      rules: [],
      shippingByVendor: { A: { id: "w", type: "WEIGHT", rateMinor: 100_000n, perKgMinor: 50_000n, freeOverMinor: null } },
    });
    expect(res.shippingMinor).toBe(100_000n + 3n * 50_000n);
  });
});
