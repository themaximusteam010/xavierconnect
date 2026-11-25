/**
 * Shared parsing/validation of the "add bank account" form (vendor settings and onboarding step 6).
 * Format checks only — the payment provider (or finance, for manual payouts) verifies the account.
 */
import { z } from "zod";
import { countryByCode } from "@/lib/countries";
import type { BeneficiaryInput } from "@/server/integrations/types";

const ROUTING: Record<string, { account: RegExp; accountMsg: string; bankCode?: RegExp; bankCodeMsg?: string }> = {
  NUBAN: { account: /^\d{10}$/, accountMsg: "Nigerian account numbers (NUBAN) are 10 digits." },
  CNAPS: { account: /^\d{8,30}$/, accountMsg: "Enter the account number (digits only).", bankCode: /^\d{12}$/, bankCodeMsg: "The CNAPS bank code is 12 digits." },
  SORT_CODE: { account: /^\d{8}$/, accountMsg: "UK account numbers are 8 digits.", bankCode: /^\d{6}$/, bankCodeMsg: "Sort codes are 6 digits." },
  ABA: { account: /^\d{4,17}$/, accountMsg: "Enter the account number.", bankCode: /^\d{9}$/, bankCodeMsg: "ABA routing numbers are 9 digits." },
  SWIFT: { account: /^[A-Z0-9]{6,34}$/, accountMsg: "Enter the account number or IBAN.", bankCode: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, bankCodeMsg: "SWIFT/BIC codes are 8 or 11 characters." },
};

const schema = z.object({
  providerKey: z.string().min(2).max(40),
  accountHolderName: z.string().trim().min(3, "Enter the account holder's name exactly as the bank shows it").max(120),
  bankName: z.string().trim().min(2, "Enter the bank name").max(120),
  bankCode: z.string().trim().toUpperCase().max(20).optional(),
  branch: z.string().trim().max(120).optional(),
  accountNumber: z.string().trim().toUpperCase().transform((x) => x.replace(/[\s-]/g, "")),
  swift: z.string().trim().toUpperCase().max(11).optional(),
  confirm: z.literal("on", { message: "Confirm that the account belongs to you or your business" }),
});

export function parseBeneficiaryForm(fd: FormData, vendor: { country: string; payoutCurrency: string }): { ok: true; providerKey: string; input: BeneficiaryInput } | { ok: false; error: string } {
  const country = countryByCode(vendor.country);
  if (!country) return { ok: false, error: "Your registration country is not supported for payouts yet." };
  const parsed = schema.safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => v !== "")));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  const rule = ROUTING[country.routing];
  if (!rule.account.test(d.accountNumber)) return { ok: false, error: rule.accountMsg };
  if (rule.bankCode && !(d.bankCode && rule.bankCode.test(d.bankCode))) return { ok: false, error: rule.bankCodeMsg! };
  if (d.swift && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(d.swift)) return { ok: false, error: "SWIFT/BIC codes are 8 or 11 characters." };
  return {
    ok: true, providerKey: d.providerKey,
    input: { country: country.code, currency: vendor.payoutCurrency, routingType: country.routing, accountHolderName: d.accountHolderName, bankName: d.bankName, bankCode: d.bankCode, branch: d.branch, accountNumber: d.accountNumber, extra: d.swift ? { swift: d.swift } : undefined },
  };
}
