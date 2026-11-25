import { describe, expect, it } from "vitest";
import { methodServes } from "@/lib/countries";
import { parseBeneficiaryForm } from "@/server/services/beneficiary-form";

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

describe("delivery method destinations", () => {
  it("domestic methods only serve the vendor's own country", () => {
    expect(methodServes("NG", { destinationCountries: [] }, "NG")).toBe(true);
    expect(methodServes("CN", { destinationCountries: [] }, "NG")).toBe(false);
    expect(methodServes("CN", { destinationCountries: ["NG", "GH"] }, "NG")).toBe(true);
    expect(methodServes("NG", { destinationCountries: ["GH"] }, "NG")).toBe(false);
  });
});

describe("bank account form", () => {
  const base = { providerKey: "manual", accountHolderName: "Ada Stores", bankName: "Bank", confirm: "on" };
  it("validates NUBAN for Nigeria", () => {
    expect(parseBeneficiaryForm(fd({ ...base, accountNumber: "12345" }), { country: "NG", payoutCurrency: "NGN" })).toMatchObject({ ok: false });
    const ok = parseBeneficiaryForm(fd({ ...base, accountNumber: "0123 456 789" }), { country: "NG", payoutCurrency: "NGN" });
    expect(ok).toMatchObject({ ok: true, input: { accountNumber: "0123456789", routingType: "NUBAN", currency: "NGN" } });
  });
  it("requires a 12-digit CNAPS code for China and takes the currency from the vendor", () => {
    expect(parseBeneficiaryForm(fd({ ...base, accountNumber: "6222020200000000", bankCode: "1234" }), { country: "CN", payoutCurrency: "CNY" })).toMatchObject({ ok: false });
    expect(parseBeneficiaryForm(fd({ ...base, accountNumber: "6222020200000000", bankCode: "102100099996", currency: "USD" }), { country: "CN", payoutCurrency: "CNY" })).toMatchObject({ ok: true, input: { currency: "CNY", routingType: "CNAPS" } });
  });
  it("requires the ownership confirmation", () => {
    const { confirm: _c, ...noConfirm } = base;
    void _c;
    expect(parseBeneficiaryForm(fd({ ...noConfirm, accountNumber: "0123456789" }), { country: "NG", payoutCurrency: "NGN" })).toMatchObject({ ok: false });
  });
});
