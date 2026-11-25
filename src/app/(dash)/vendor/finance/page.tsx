import Link from "next/link";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { vendorBalances } from "@/server/domain/ledger";
import { getSetting } from "@/server/services/settings";
import { PageHeader, Stat } from "@/components/ui/page-header";
import { FlashFromQuery } from "@/components/ui/feedback";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Finance" };

export default async function Earnings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { vendorId } = await requireVendor("finance");
  const sp = await searchParams;
  const [bal, payouts, totals, hold] = await Promise.all([
    vendorBalances(db, vendorId),
    db.payout.aggregate({ where: { vendorId, status: "PAID" }, _sum: { amountMinor: true } }),
    db.vendorOrder.aggregate({ where: { vendorId, status: { notIn: ["AWAITING_PAYMENT", "CANCELLED"] } }, _sum: { subtotalMinor: true, discountMinor: true, commissionMinor: true, shippingMinor: true, vendorNetMinor: true } }),
    getSetting(db, "settlementHoldDays"),
  ]);
  const refunded = await db.vendorOrder.aggregate({ where: { vendorId, status: "REFUNDED" }, _sum: { vendorNetMinor: true } });

  return (
    <>
      <PageHeader title="Finance" description={`Balances are calculated from the marketplace ledger. Earnings become available ${hold} days after confirmed delivery (longer when only you have marked it delivered).`} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available to withdraw" value={formatMoney(bal.available)} />
        <Stat label="Pending" value={formatMoney(bal.pending)} hint="Awaiting delivery or hold period" />
        <Stat label="In withdrawal" value={formatMoney(bal.payoutHold)} />
        <Stat label="Paid out to date" value={formatMoney(payouts._sum.amountMinor ?? 0n)} />
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
        </div>
        <aside className="h-fit space-y-2 rounded-lg border border-line bg-white p-4 text-sm">
          <h2 className="mb-1 font-semibold">Money</h2>
          {[["/vendor/payouts", "Withdraw & payout history"], ["/vendor/bank-accounts", "Bank accounts"], ["/vendor/settlements", "Settlement schedule"], ["/vendor/transactions", "Transactions & statement"], ["/vendor/payments", "Payment availability in your country"]].map(([h, l]) => <Link key={h} href={h} className="block text-brand hover:underline">{l}</Link>)}
          <p className="pt-2 text-[12px] text-ink-muted">Balances are records in the XavierConnect ledger of what we owe you. Funds are paid out through our payment partners; the ledger balance itself is not a bank account.</p>
        </aside>
      </div>
    </>
  );
}
