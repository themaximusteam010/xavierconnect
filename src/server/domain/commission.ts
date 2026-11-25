import { applyBps, min } from "@/lib/money";

export type CommissionScope = "GLOBAL" | "SUBSCRIPTION" | "CATEGORY" | "VENDOR" | "PRODUCT";

export interface CommissionRuleInput {
  id: string;
  scope: CommissionScope;
  rateBps: number;
  fixedMinor: bigint;
  categoryId?: string | null;
  vendorId?: string | null;
  productId?: string | null;
  planKey?: string | null;
  active: boolean;
}

export interface CommissionContext {
  productId: string;
  vendorId: string;
  categoryId: string;
  /** Category ancestry, nearest first, so a rule on a parent category applies to children. */
  categoryAncestors?: string[];
  planKey?: string | null;
}

const PRECEDENCE: CommissionScope[] = ["PRODUCT", "VENDOR", "CATEGORY", "SUBSCRIPTION", "GLOBAL"];

/** Pick the most specific active rule. PRODUCT > VENDOR > CATEGORY (nearest) > SUBSCRIPTION > GLOBAL. */
export function resolveCommissionRule(
  rules: CommissionRuleInput[],
  ctx: CommissionContext,
): CommissionRuleInput | null {
  const active = rules.filter((r) => r.active);
  for (const scope of PRECEDENCE) {
    const candidates = active.filter((r) => r.scope === scope);
    if (scope === "PRODUCT") {
      const r = candidates.find((c) => c.productId === ctx.productId);
      if (r) return r;
    } else if (scope === "VENDOR") {
      const r = candidates.find((c) => c.vendorId === ctx.vendorId);
      if (r) return r;
    } else if (scope === "CATEGORY") {
      const chain = [ctx.categoryId, ...(ctx.categoryAncestors ?? [])];
      for (const cat of chain) {
        const r = candidates.find((c) => c.categoryId === cat);
        if (r) return r;
      }
    } else if (scope === "SUBSCRIPTION") {
      const r = ctx.planKey ? candidates.find((c) => c.planKey === ctx.planKey) : undefined;
      if (r) return r;
    } else {
      if (candidates[0]) return candidates[0];
    }
  }
  return null;
}

/**
 * Commission on one order line. `baseMinor` is the amount commission is charged on
 * (line total after vendor-funded discounts). Never exceeds the base.
 */
export function computeLineCommission(
  rule: Pick<CommissionRuleInput, "rateBps" | "fixedMinor"> | null,
  baseMinor: bigint,
  quantity: number,
): bigint {
  if (!rule || baseMinor <= 0n) return 0n;
  const c = applyBps(baseMinor, rule.rateBps) + rule.fixedMinor * BigInt(quantity);
  return min(c, baseMinor);
}
