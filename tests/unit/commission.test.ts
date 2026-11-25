import { describe, expect, it } from "vitest";
import { computeLineCommission, resolveCommissionRule, type CommissionRuleInput } from "@/server/domain/commission";

const r = (o: Partial<CommissionRuleInput> & Pick<CommissionRuleInput, "id" | "scope">): CommissionRuleInput => ({
  rateBps: 0, fixedMinor: 0n, active: true, ...o,
});
const rules = [
  r({ id: "g", scope: "GLOBAL", rateBps: 1000 }),
  r({ id: "plan", scope: "SUBSCRIPTION", planKey: "GROWTH", rateBps: 800 }),
  r({ id: "cat-parent", scope: "CATEGORY", categoryId: "electronics", rateBps: 700 }),
  r({ id: "cat", scope: "CATEGORY", categoryId: "phones", rateBps: 500 }),
  r({ id: "v", scope: "VENDOR", vendorId: "v1", rateBps: 300 }),
  r({ id: "p", scope: "PRODUCT", productId: "p1", rateBps: 200 }),
  r({ id: "off", scope: "PRODUCT", productId: "p2", rateBps: 0, active: false }),
];

describe("commission rule precedence", () => {
  it("product beats everything", () => {
    expect(resolveCommissionRule(rules, { productId: "p1", vendorId: "v1", categoryId: "phones" })?.id).toBe("p");
  });
  it("vendor beats category", () => {
    expect(resolveCommissionRule(rules, { productId: "x", vendorId: "v1", categoryId: "phones" })?.id).toBe("v");
  });
  it("nearest category wins, then ancestors", () => {
    expect(resolveCommissionRule(rules, { productId: "x", vendorId: "v9", categoryId: "phones" })?.id).toBe("cat");
    expect(resolveCommissionRule(rules, { productId: "x", vendorId: "v9", categoryId: "tablets", categoryAncestors: ["electronics"] })?.id).toBe("cat-parent");
  });
  it("subscription plan before global; inactive rules ignored", () => {
    expect(resolveCommissionRule(rules, { productId: "x", vendorId: "v9", categoryId: "food", planKey: "GROWTH" })?.id).toBe("plan");
    expect(resolveCommissionRule(rules, { productId: "p2", vendorId: "v9", categoryId: "food" })?.id).toBe("g");
  });
});

describe("line commission", () => {
  it("matches the spec example: ₦100,000 at 10% = ₦10,000", () => {
    expect(computeLineCommission({ rateBps: 1000, fixedMinor: 0n }, 10_000_000n, 1)).toBe(1_000_000n);
  });
  it("adds fixed per unit and caps at base", () => {
    expect(computeLineCommission({ rateBps: 500, fixedMinor: 10_000n }, 200_000n, 2)).toBe(30_000n);
    expect(computeLineCommission({ rateBps: 0, fixedMinor: 999_999n }, 50_000n, 1)).toBe(50_000n);
    expect(computeLineCommission(null, 50_000n, 1)).toBe(0n);
  });
});
