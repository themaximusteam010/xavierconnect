import Link from "next/link";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { vendorBalances } from "@/server/domain/ledger";
import { getSetting } from "@/server/services/settings";
import { adapterName } from "@/server/services/payouts";
import { requestPayoutAction } from "@/app/actions/vendor";
import { PageHeader, Stat } from "@/components/ui/page-header";
import { Alert, FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney, minorToInput } from "@/lib/money";
import { minorToDecimal } from "@/lib/csv";

export const metadata = { title: "Payouts" };

const STATUS_TEXT: Record<string, string> = {
  REQUESTED: "Waiting for finance review",
  APPROVED: "Approved — bank transfer being made",
  PROCESSING: "Sent to the payment provider — waiting for confirmation",
  PAID: "Paid",
  FAILED: "Failed — amount returned to your balance",
  REJECTED: "Not approved — amount returned to your balance",
};

export default async function Payouts({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { vendorId, vendor } = await requireVendor("finance");
  const sp = await searchParams;
  const [bal, payouts, ben, minPayout] = await Promise.all([
    vendorBalances(db, vendorId),
    db.payout.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" }, take: 100, include: { beneficiary: { select: { bankName: true, accountLast4: true } }, fxQuote: true } }),
    db.beneficiary.findFirst({ where: { vendorId, isDefault: true, status: "VERIFIED", disabledAt: null } }),
    getSetting(db, "minPayoutMinor"),
  ]);
  const cross = ben && ben.currency !== "NGN";
  return (
    <>
      <PageHeader title="Payouts" description="A withdrawal is marked paid only when the bank transfer is confirmed — by the payment provider, or by finance with the bank reference for manual transfers." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Available to withdraw" value={formatMoney(bal.available)} />
        <Stat label="In withdrawal" value={formatMoney(bal.payoutHold)} />
        <Stat label="Pending settlement" value={formatMoney(bal.pending)} hint={<Link href="/vendor/settlements" className="text-brand">When will it be available?</Link>} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Table>
          <thead><tr><Th>Requested</Th><Th className="text-right">Amount</Th><Th>To</Th><Th>Status</Th><Th>Reference</Th></tr></thead>
          <tbody>
            {payouts.length === 0 && <tr><Td colSpan={5} className="py-8 text-center text-ink-muted">No withdrawals yet.</Td></tr>}
            {payouts.map((p) => (
              <tr key={p.id}>
                <Td>{p.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td>
                <Td className="tabular text-right">{formatMoney(p.amountMinor)}{p.settlementCurrency && p.settlementCurrency !== p.currency && p.settlementAmountMinor != null && <span className="block text-[11px] text-ink-muted">→ {p.settlementCurrency} {minorToDecimal(p.settlementAmountMinor)} at {p.fxRate?.toString()}{p.providerFeeMinor > 0n && `, fee ${formatMoney(p.providerFeeMinor)}`}</span>}</Td>
                <Td>{p.beneficiary ? `${p.beneficiary.bankName} ••••${p.beneficiary.accountLast4}` : "—"}<span className="block text-[11px] text-ink-muted">{adapterName(p.providerKey)}</span></Td>
                <Td><StatusBadge status={p.status} /><span className="block text-[11px] text-ink-muted">{STATUS_TEXT[p.status] ?? ""}</span>{p.failureReason && <span className="block text-[11px] text-danger">{p.failureReason}</span>}</Td>
                <Td className="font-mono text-[12px]">{p.providerRef ?? "—"}{p.paidAt && <span className="block font-sans text-[11px] text-ink-muted">paid {p.paidAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <aside className="h-fit rounded-lg border border-line bg-white p-4">
          <h2 className="mb-3 font-semibold">Withdraw</h2>
          {vendor.status !== "APPROVED" ? <p className="text-sm text-ink-muted">Withdrawals open once your store is approved.</p>
            : !ben ? <p className="text-sm text-ink-muted">Add a bank account and wait for it to be verified on <Link href="/vendor/bank-accounts" className="text-brand underline">Bank accounts</Link>.</p>
            : (
              <form action={requestPayoutAction} className="space-y-3">
                <input type="hidden" name="key" value={randomUUID()} />
                <p className="text-sm text-ink-2">To {ben.bankName} ••••{ben.accountLast4} ({ben.currency})</p>
                <label className="block text-[13px] font-medium text-ink-2">Amount (₦)<Input name="amount" inputMode="decimal" defaultValue={minorToInput(bal.available)} className="mt-1.5" /></label>
                <p className="text-[12px] text-ink-muted">Minimum {formatMoney(BigInt(minPayout))}. Finance reviews requests each business day.</p>
                {cross && <Alert tone="info">Your balance is in naira. When finance approves the withdrawal, our payment partner quotes the {ben.currency} exchange rate and fee; you will see the rate, fee and {ben.currency} amount here once it is sent.</Alert>}
                <SubmitButton className="w-full" disabled={bal.available < BigInt(minPayout)}>Request withdrawal</SubmitButton>
              </form>
            )}
        </aside>
      </div>
    </>
  );
}
