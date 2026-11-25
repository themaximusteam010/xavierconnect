import { describe, expect, it } from "vitest";
import { hasVendorCapability, permissionsFor } from "@/server/auth/rbac";
import { assertBalanced, LedgerError } from "@/server/domain/ledger";

describe("rbac", () => {
  it("unions permissions across roles", () => {
    const p = permissionsFor([{ role: "CUSTOMER", vendorId: null }, { role: "FINANCE_MANAGER", vendorId: null }]);
    expect(p.has("finance.payout.approve")).toBe(true);
    expect(p.has("vendor.approve")).toBe(false);
  });
  it("customers and vendors get no admin permissions", () => {
    expect(permissionsFor([{ role: "CUSTOMER", vendorId: null }, { role: "VENDOR", vendorId: "v1" }]).size).toBe(0);
  });
  it("vendor capabilities are scoped to the vendor id", () => {
    const g = [{ role: "VENDOR", vendorId: "v1" }, { role: "VENDOR_STAFF", vendorId: "v2" }];
    expect(hasVendorCapability(g, "v1", "finance")).toBe(true);
    expect(hasVendorCapability(g, "v2", "orders")).toBe(true);
    expect(hasVendorCapability(g, "v2", "finance")).toBe(false); // staff cannot see money
    expect(hasVendorCapability(g, "v3", "orders")).toBe(false); // other tenant
  });
});

describe("ledger balance check", () => {
  it("accepts balanced entries", () => {
    expect(() => assertBalanced([{ account: "a", debit: 10n }, { account: "b", credit: 4n }, { account: "c", credit: 6n }])).not.toThrow();
  });
  it("rejects unbalanced, two-sided and negative entries", () => {
    expect(() => assertBalanced([{ account: "a", debit: 10n }, { account: "b", credit: 9n }])).toThrow(LedgerError);
    expect(() => assertBalanced([{ account: "a", debit: 1n, credit: 1n }])).toThrow(LedgerError);
    expect(() => assertBalanced([{ account: "a", debit: -1n }, { account: "b", credit: -1n }])).toThrow(LedgerError);
  });
});
