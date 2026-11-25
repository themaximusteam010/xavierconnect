import { adapterName } from "@/server/services/payouts";
import { Alert } from "@/components/ui/feedback";
import { Input, Select, Checkbox } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { countryByCode } from "@/lib/countries";

const FIELDS: Record<string, { bankCode?: string; bankCodeHint?: string; account: string; swift?: boolean; branch?: boolean }> = {
  NUBAN: { account: "Account number (10-digit NUBAN)" },
  CNAPS: { bankCode: "CNAPS bank code", bankCodeHint: "12 digits — your bank branch can provide it", account: "Account number", swift: true, branch: true },
  SORT_CODE: { bankCode: "Sort code", bankCodeHint: "6 digits", account: "Account number (8 digits)" },
  ABA: { bankCode: "ABA routing number", bankCodeHint: "9 digits", account: "Account number" },
  SWIFT: { bankCode: "SWIFT / BIC", bankCodeHint: "8 or 11 characters", account: "Account number or IBAN", branch: true },
};

/** Country-aware bank-account form. Never asks for online-banking passwords, PINs or OTPs. */
export function BeneficiaryForm({ vendor, providers, action, submitLabel = "Add account" }: { vendor: { country: string; payoutCurrency: string }; providers: string[]; action: (fd: FormData) => Promise<void>; submitLabel?: string }) {
  const country = countryByCode(vendor.country);
  const f = FIELDS[country?.routing ?? "SWIFT"];
  if (providers.length === 0)
    return <Alert tone="warning" title={`Payouts to ${country?.name ?? vendor.country} in ${vendor.payoutCurrency} are not available yet`}>XavierConnect pays vendors only through licensed payment partners. We are completing the partnership and compliance approvals for this route. Your earnings stay recorded in your balance in the meantime; we will email you when you can add an account.</Alert>;
  return (
    <form action={action} className="space-y-3 text-[13px]">
      {providers.length > 1 ? <label className="block">Paid through<Select name="providerKey">{providers.map((p) => <option key={p} value={p}>{adapterName(p)}</option>)}</Select></label> : <input type="hidden" name="providerKey" value={providers[0]} />}
      <label className="block">Account holder name<Input name="accountHolderName" required autoComplete="off" /></label>
      <label className="block">Bank name<Input name="bankName" required /></label>
      {f.branch && <label className="block">Branch<Input name="branch" /></label>}
      {f.bankCode && <label className="block">{f.bankCode}<Input name="bankCode" required autoComplete="off" /><span className="text-[11px] text-ink-muted">{f.bankCodeHint}</span></label>}
      {country?.routing === "NUBAN" && <label className="block">Bank code (optional)<Input name="bankCode" autoComplete="off" placeholder="e.g. 058" /></label>}
      <label className="block">{f.account}<Input name="accountNumber" required autoComplete="off" inputMode={country?.routing === "SWIFT" ? "text" : "numeric"} /></label>
      {f.swift && <label className="block">SWIFT / BIC (for international transfers)<Input name="swift" autoComplete="off" /></label>}
      <Checkbox name="confirm" label="This account belongs to me or my registered business." required />
      <SubmitButton className="w-full">{submitLabel}</SubmitButton>
      <p className="text-[11px] text-ink-muted">We will never ask for your online-banking password, PIN or one-time codes. Full account details are encrypted; only the last four digits are shown after saving.</p>
    </form>
  );
}
