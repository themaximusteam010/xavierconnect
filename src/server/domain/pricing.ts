/**
 * Pure order pricing + vendor split. No database access: callers load the data, this computes.
 *
 * Funding rules (documented in docs/ARCHITECTURE.md → "Money flow"):
 *  - Vendor coupons are funded by the vendor: they reduce the commission base.
 *  - Platform coupons are funded by XavierConnect: the vendor is paid as if no discount applied.
 *  - Shipping is collected for the vendor (vendor-managed delivery) and is not commissionable.
 *  - Tax (if configured) is collected by the platform into a tax-payable account.
 */
import { allocate, applyBps, max, min, sum } from "@/lib/money";
import { computeLineCommission, resolveCommissionRule, type CommissionRuleInput } from "./commission";

export type LineKind = "PHYSICAL" | "DIGITAL" | "SERVICE";

export interface PricingLine {
  key: string; // stable id for the line (cart item id)
  vendorId: string;
  productId: string;
  categoryId: string;
  categoryAncestors?: string[];
  kind: LineKind;
  unitPriceMinor: bigint;
  quantity: number;
  weightGrams?: number | null;
}

export interface ShippingMethodInput {
  id: string;
  type: "FLAT" | "WEIGHT" | "PICKUP";
  rateMinor: bigint;
  perKgMinor: bigint;
  freeOverMinor: bigint | null;
}

export interface CouponInput {
  code: string;
  vendorId: string | null;
  type: "PERCENT" | "FIXED";
  value: number; // bps or minor units
  minSubtotalMinor: bigint;
  maxDiscountMinor: bigint | null;
}

export interface PricingInput {
  lines: PricingLine[];
  rules: CommissionRuleInput[];
  shippingByVendor: Record<string, ShippingMethodInput | null | undefined>;
  coupon?: CouponInput | null;
  vendorPlans?: Record<string, string | null | undefined>;
  taxBps?: number;
}

export interface PricedLine extends PricingLine {
  lineTotalMinor: bigint;
  vendorDiscountMinor: bigint;
  platformDiscountMinor: bigint;
  commissionMinor: bigint;
  commissionRuleId: string | null;
}

export interface VendorBreakdown {
  vendorId: string;
  lines: PricedLine[];
  subtotalMinor: bigint;
  vendorDiscountMinor: bigint;
  platformDiscountMinor: bigint;
  shippingMinor: bigint;
  taxMinor: bigint;
  /** What the customer pays for this vendor's slice. */
  totalMinor: bigint;
  commissionMinor: bigint;
  /** Owed to the vendor: items after vendor discount + shipping − commission. */
  vendorNetMinor: bigint;
}

export interface PricingResult {
  vendors: VendorBreakdown[];
  subtotalMinor: bigint;
  discountMinor: bigint;
  shippingMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  couponApplied: boolean;
  couponMessage?: string;
}

export function shippingFor(
  method: ShippingMethodInput | null | undefined,
  physicalSubtotal: bigint,
  weightGrams: number,
): bigint {
  if (!method) return 0n;
  if (method.freeOverMinor != null && physicalSubtotal >= method.freeOverMinor) return 0n;
  switch (method.type) {
    case "PICKUP":
      return 0n;
    case "FLAT":
      return method.rateMinor;
    case "WEIGHT": {
      const kg = BigInt(Math.max(1, Math.ceil(weightGrams / 1000)));
      return method.rateMinor + method.perKgMinor * kg;
    }
  }
}

export function couponDiscount(coupon: CouponInput, eligibleSubtotal: bigint): bigint {
  if (eligibleSubtotal <= 0n || eligibleSubtotal < coupon.minSubtotalMinor) return 0n;
  let d = coupon.type === "PERCENT" ? applyBps(eligibleSubtotal, coupon.value) : BigInt(coupon.value);
  if (coupon.maxDiscountMinor != null) d = min(d, coupon.maxDiscountMinor);
  return min(d, eligibleSubtotal);
}

export function priceOrder(input: PricingInput): PricingResult {
  const { lines, rules, coupon, taxBps = 0 } = input;
  const vendorIds = [...new Set(lines.map((l) => l.vendorId))];

  const priced: PricedLine[] = lines.map((l) => ({
    ...l,
    lineTotalMinor: l.unitPriceMinor * BigInt(l.quantity),
    vendorDiscountMinor: 0n,
    platformDiscountMinor: 0n,
    commissionMinor: 0n,
    commissionRuleId: null,
  }));

  // Coupon
  let couponApplied = false;
  let couponMessage: string | undefined;
  if (coupon) {
    const eligible = priced.filter((l) => coupon.vendorId == null || l.vendorId === coupon.vendorId);
    const eligibleSubtotal = sum(eligible.map((l) => l.lineTotalMinor));
    const discount = couponDiscount(coupon, eligibleSubtotal);
    if (discount > 0n) {
      couponApplied = true;
      const parts = allocate(discount, eligible.map((l) => l.lineTotalMinor));
      eligible.forEach((l, i) => {
        if (coupon.vendorId) l.vendorDiscountMinor = parts[i];
        else l.platformDiscountMinor = parts[i];
      });
    } else if (eligibleSubtotal === 0n) {
      couponMessage = "This code does not apply to anything in your cart.";
    } else {
      couponMessage = "Your cart does not meet the minimum spend for this code.";
    }
  }

  // Commission per line, on the vendor-funded net
  for (const l of priced) {
    const rule = resolveCommissionRule(rules, {
      productId: l.productId,
      vendorId: l.vendorId,
      categoryId: l.categoryId,
      categoryAncestors: l.categoryAncestors,
      planKey: input.vendorPlans?.[l.vendorId] ?? null,
    });
    l.commissionRuleId = rule?.id ?? null;
    l.commissionMinor = computeLineCommission(rule, l.lineTotalMinor - l.vendorDiscountMinor, l.quantity);
  }

  const vendors: VendorBreakdown[] = vendorIds.map((vendorId) => {
    const vl = priced.filter((l) => l.vendorId === vendorId);
    const subtotal = sum(vl.map((l) => l.lineTotalMinor));
    const vendorDiscount = sum(vl.map((l) => l.vendorDiscountMinor));
    const platformDiscount = sum(vl.map((l) => l.platformDiscountMinor));
    const physical = vl.filter((l) => l.kind === "PHYSICAL");
    const physicalSubtotal = sum(physical.map((l) => l.lineTotalMinor - l.vendorDiscountMinor));
    const weight = physical.reduce((a, l) => a + (l.weightGrams ?? 0) * l.quantity, 0);
    const shipping = physical.length ? shippingFor(input.shippingByVendor[vendorId], physicalSubtotal, weight) : 0n;
    const taxable = max(0n, subtotal - vendorDiscount - platformDiscount);
    const tax = applyBps(taxable, taxBps);
    const commission = sum(vl.map((l) => l.commissionMinor));
    return {
      vendorId,
      lines: vl,
      subtotalMinor: subtotal,
      vendorDiscountMinor: vendorDiscount,
      platformDiscountMinor: platformDiscount,
      shippingMinor: shipping,
      taxMinor: tax,
      totalMinor: taxable + shipping + tax,
      commissionMinor: commission,
      vendorNetMinor: subtotal - vendorDiscount + shipping - commission,
    };
  });

  return {
    vendors,
    subtotalMinor: sum(vendors.map((v) => v.subtotalMinor)),
    discountMinor: sum(vendors.map((v) => v.vendorDiscountMinor + v.platformDiscountMinor)),
    shippingMinor: sum(vendors.map((v) => v.shippingMinor)),
    taxMinor: sum(vendors.map((v) => v.taxMinor)),
    totalMinor: sum(vendors.map((v) => v.totalMinor)),
    couponApplied,
    couponMessage,
  };
}
