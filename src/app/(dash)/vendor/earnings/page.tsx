import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { vendorAccountCode, vendorBalances } from "@/server/domain/ledger";
import { getSetting } from "@/server/services/settings";
import { requestPayoutAction } from "@/app/actions/vendor";
import { PageHeader, Stat } from "@/components/ui/page-header";
import { FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney, minorToInput } from "@/lib/money";

export const metadata = { title: "Earnings" };

export default async function Earnings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { vendorId, vendor } = await requireVendor("finance");
  const sp = await searchParams;
  const [bal, payouts, entries, totals, account, minPayout, hold] = await Promise.all([
    vendorBalances(db, vendorId),
    db.payout.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.ledgerEntry.findMany({ where: { account: { vendorId } }, orderBy: { createdAt: "desc" }, take: 50, include: { account: true, transaction: true } }),
    db.vendorOrder.aggregate({ where: { vendorId, status: { notIn: ["AWAITING_PAYMENT", "CANCELLED"] } }, _sum: { subtotalMinor: true, discountMinor: true, commissionMinor: true, shippingMinor: true, vendorNetMinor: true } }),
    db.payoutAccount.findUnique({ where: { vendorId } }),
    getSetting(db, "minPayoutMinor"),
    getSetting(db, "settlementHoldDays"),
  ]);
  const refunded = await db.vendorOrder.aggregate({ where: { vendorId, status: "REFUNDED" }, _sum: { vendorNetMinor: true } });
  const label = (code: string) => code === vendorAccountCode(vendorId, "pending") ? "Pending" : code === vendorAccountCode(vendorId, "available") ? "Available" : "Withdrawal hold";

  return (
    <>
      <PageHeader title="Earnings" description={`Balances are calculated from the marketplace ledger. Earnings move from pending to available ${hold} days after delivery.`} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available to withdraw" value={formatMoney(bal.available)} />
        <Stat label="Pending" value={formatMoney(bal.pending)} hint="Awaiting delivery or hold period" />
        <Stat label="In withdrawal" value={formatMoney(bal.payoutHold)} />
        <Stat label="Paid out to date" value={formatMoney(payouts.filter((p) => p.status === "PAID").reduce((a, p) => a + p.amountMinor, 0n))} />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 font-semibold">Lifetime breakdown</h2>
            <dl className="tabular divide-y divide-line rounded-lg border border-line bg-white text-sm">
              {[["Gross sales", totals._sum.subtotalMinor], ["Delivery fees collected", totals._sum.shippingMinor], ["Marketplace commission", -(totals._sum.commissionMinor ?? 0n)], ["Refunded orders (net)", -(refunded._sum.vendorNetMinor ?? 0n)]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between px-4 py-2.5"><dt className="text-ink-muted">{k as string}</dt><dd>{formatMoney((v as bigint) ?? 0n)}</dd></div>
              ))}
              <div className="flex justify-between px-4 py-2.5 font-semibold"><dt>Net earnings</dt><dd>{formatMoney((totals._sum.vendorNetMinor ?? 0n) - (refunded._sum.vendorNetMinor ?? 0n))}</dd></div>
            </dl>
            <p className="mt-2 text-[12px] text-ink-muted">Payment processing fees are currently borne by XavierConnect and are not deducted from your earnings.</p>
          </section>
          <section>
            <h2 className="mb-3 font-semibold">Withdrawals</h2>
            {payouts.length === 0 ? <p className="text-sm text-ink-muted">No withdrawals yet.</p> : (
              <Table><thead><tr><Th>Requested</Th><Th>Status</Th><Th>Reference</Th><Th className="text-right">Amount</Th></tr></thead>
                <tbody>{payouts.map((p) => <tr key={p.id}><Td>{p.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td><Td><StatusBadge status={p.status} />{p.failureReason && <p className="text-[12px] text-danger">{p.failureReason}</p>}</Td><Td>{p.providerRef ?? "—"}</Td><Td className="tabular text-right">{formatMoney(p.amountMinor)}</Td></tr>)}</tbody>
              </Table>
            )}
          </section>
          <section>
            <h2 className="mb-3 font-semibold">Ledger activity</h2>
            {entries.length === 0 ? <p className="text-sm text-ink-muted">No activity yet.</p> : (
              <Table><thead><tr><Th>Date</Th><Th>Description</Th><Th>Balance</Th><Th className="text-right">Amount</Th></tr></thead>
                <tbody>{entries.map((e) => <tr key={e.id}><Td>{e.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td><Td>{e.transaction.description}</Td><Td>{label(e.account.code)}</Td><Td className={`tabular text-right ${e.creditMinor > 0n ? "text-success" : ""}`}>{e.creditMinor > 0n ? `+${formatMoney(e.creditMinor)}` : `−${formatMoney(e.debitMinor)}`}</Td></tr>)}</tbody>
              </Table>
            )}
          </section>
        </div>
        <aside className="h-fit rounded-lg border border-line bg-white p-4">
          <h2 className="mb-3 font-semibold">Withdraw</h2>
          {!account?.verifiedAt ? <p className="text-sm text-ink-muted">Add a verified payout account in your <a href="/sell/apply?step=6" className="text-brand underline">application</a> first.</p> : vendor.status !== "APPROVED" ? <p className="text-sm text-ink-muted">Withdrawals open once your store is approved.</p> : (
            <form action={requestPayoutAction} className="space-y-3">
              <input type="hidden" name="key" value={randomUUID()} />
              <p className="text-sm text-ink-2">To {account.bankName} ••••{account.accountNumberLast4}</p>
              <label className="block text-[13px] font-medium text-ink-2">Amount (₦)<Input name="amount" inputMode="decimal" defaultValue={minorToInput(bal.available)} className="mt-1.5" /></label>
              <p className="text-[12px] text-ink-muted">Minimum {formatMoney(BigInt(minPayout))}. Requests are reviewed by Finance and usually paid within one business day.</p>
              <SubmitButton className="w-full" disabled={bal.available < BigInt(minPayout)}>Request withdrawal</SubmitButton>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
