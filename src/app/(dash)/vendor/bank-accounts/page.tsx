import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { adapterName, beneficiaryProvidersFor } from "@/server/services/payouts";
import { BeneficiaryForm } from "@/components/beneficiary-form";
import { addBeneficiaryAction, beneficiaryOpAction } from "@/app/actions/vendor-finance";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { countryByCode } from "@/lib/countries";

export const metadata = { title: "Bank accounts" };

export default async function BankAccounts({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { vendorId, vendor } = await requireVendor("finance");
  const sp = await searchParams;
  const country = countryByCode(vendor.country);
  const [list, providers] = await Promise.all([
    db.beneficiary.findMany({ where: { vendorId, status: { not: "DISABLED" } }, orderBy: { createdAt: "desc" } }),
    beneficiaryProvidersFor(vendor.country, vendor.payoutCurrency),
  ]);
  return (
    <>
      <PageHeader title="Bank accounts" description="Where your withdrawals are paid. We never ask for your online-banking password, PIN or one-time codes." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          {list.length === 0 && <p className="rounded-lg border border-line bg-white p-6 text-sm text-ink-muted">No bank accounts yet.</p>}
          {list.map((b) => (
            <div key={b.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-white p-4 text-sm">
              <div>
                <p className="font-medium">{b.bankName}{b.branch && `, ${b.branch}`} ••••{b.accountLast4} {b.isDefault && <Badge tone="brand">default</Badge>}</p>
                <p className="text-ink-muted">{b.verifiedName ?? b.accountHolderName} · {b.currency} · {b.routingType} · via {adapterName(b.providerKey)}</p>
                <p className="mt-1"><StatusBadge status={b.status === "PENDING_VERIFICATION" ? "PENDING_REVIEW" : b.status === "VERIFIED" ? "APPROVED" : "REJECTED"} /> {b.status === "PENDING_VERIFICATION" && <span className="text-[12px] text-ink-muted">Being verified — you can withdraw once it is confirmed.</span>}{b.failureReason && <span className="text-[12px] text-danger">{b.failureReason}</span>}</p>
              </div>
              <form action={beneficiaryOpAction} className="flex gap-2">
                <input type="hidden" name="id" value={b.id} />
                {b.status === "VERIFIED" && !b.isDefault && <SubmitButton name="op" value="default" size="sm" variant="secondary">Make default</SubmitButton>}
                <SubmitButton name="op" value="disable" size="sm" variant="ghost" confirm="Remove this bank account?">Remove</SubmitButton>
              </form>
            </div>
          ))}
        </div>
        <aside className="h-fit rounded-lg border border-line bg-white p-4">
          <h2 className="mb-1 font-semibold">Add an account</h2>
          <p className="mb-3 text-[12px] text-ink-muted">{country?.name ?? vendor.country} · paid in {vendor.payoutCurrency}. The account must belong to you or your registered business.</p>
          <BeneficiaryForm vendor={vendor} providers={providers} action={addBeneficiaryAction} />
        </aside>
      </div>
    </>
  );
}
