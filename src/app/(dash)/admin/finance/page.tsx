import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { trialBalance } from "@/server/services/finance";
import { deactivateCommissionRuleAction, payoutDecisionAction, runSettlementAction, saveCommissionRuleAction } from "@/app/actions/admin";
import { PageHeader } from "@/components/ui/page-header";
import { Alert, FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Finance" };

export default async function Finance({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const u = await guard("finance.view");
  const sp = await searchParams;
  const [tb, payouts, rules, cats, vendors, failedRefunds] = await Promise.all([
    trialBalance(),
    db.payout.findMany({ where: { status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } }, orderBy: { createdAt: "asc" }, include: { vendor: { include: { store: true, payoutAccount: true } } } }),
    db.commissionRule.findMany({ where: { active: true }, orderBy: [{ scope: "asc" }], include: { category: true, vendor: { include: { store: true } } } }),
    db.category.findMany({ where: { kind: { not: "SERVICE" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.vendor.findMany({ where: { status: "APPROVED" }, select: { id: true, businessName: true } }),
    db.refund.findMany({ where: { status: { in: ["FAILED", "REQUESTED"] } }, include: { order: { select: { number: true } } } }),
  ]);
  const vendorAccounts = tb.filter((r) => r.code.startsWith("vendor:"));
  const platform = tb.filter((r) => r.code.startsWith("platform:"));
  const td = tb.reduce((a, r) => a + r.debit, 0n);
  const tc = tb.reduce((a, r) => a + r.credit, 0n);
  const sumBucket = (b: string) => vendorAccounts.filter((r) => r.code.endsWith(`:${b}`)).reduce((a, r) => a + r.credit - r.debit, 0n);
  const canPay = u.permissions.has("finance.payout.approve");
  return (
    <>
      <PageHeader title="Finance" description="All figures are derived from the double-entry ledger." actions={canPay && <form action={runSettlementAction}><SubmitButton variant="secondary">Run settlement now</SubmitButton></form>} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      {td !== tc && <Alert tone="danger" title="Ledger out of balance" className="mb-6">Debits {formatMoney(td)} ≠ credits {formatMoney(tc)}. Investigate immediately.</Alert>}
      {failedRefunds.length > 0 && <Alert tone="warning" title={`${failedRefunds.length} refund(s) need attention`} className="mb-6">{failedRefunds.map((r) => `${r.order.number} (${r.reason})`).join(", ")}</Alert>}

      <section className="mb-10">
        <h2 className="mb-3 font-semibold">Withdrawal requests</h2>
        {payouts.length === 0 ? <p className="text-sm text-ink-muted">No pending requests.</p> : (
          <Table><thead><tr><Th>Vendor</Th><Th>Requested</Th><Th>Bank</Th><Th className="text-right">Amount</Th><Th>Action</Th></tr></thead>
            <tbody>{payouts.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium text-ink">{p.vendor.store?.name ?? p.vendor.businessName}<StatusBadge status={p.status} /></Td>
                <Td>{p.createdAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</Td>
                <Td>{p.vendor.payoutAccount ? `${p.vendor.payoutAccount.bankName} ••••${p.vendor.payoutAccount.accountNumberLast4}` : <span className="text-danger">No account</span>}<span className="block text-[12px] text-ink-muted">{p.vendor.payoutAccount?.accountName}</span></Td>
                <Td className="tabular text-right font-medium">{formatMoney(p.amountMinor)}</Td>
                <Td>{canPay ? (
                  <div className="space-y-2">
                    <form action={payoutDecisionAction} className="flex gap-2"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="paid" /><Input name="ref" placeholder="Transfer ref" className="h-8 w-32" required /><SubmitButton size="sm" confirm={`Confirm ${formatMoney(p.amountMinor)} has been transferred?`}>Mark paid</SubmitButton></form>
                    <form action={payoutDecisionAction} className="flex gap-2"><input type="hidden" name="id" value={p.id} /><Input name="reason" placeholder="Reason" className="h-8 w-32" /><SubmitButton name="op" value="rejected" size="sm" variant="ghost">Reject</SubmitButton><SubmitButton name="op" value="failed" size="sm" variant="ghost">Failed</SubmitButton></form>
                  </div>
                ) : "—"}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
        <p className="mt-2 text-[12px] text-ink-muted">Automatic transfers via the payment provider's Transfers API are not enabled. Pay by bank transfer, then record the reference here.</p>
      </section>

      <section className="mb-10 grid gap-6 2xl:grid-cols-2">
        <div>
          <h2 className="mb-3 font-semibold">Platform accounts</h2>
          <Table><thead><tr><Th>Account</Th><Th className="text-right">Debits</Th><Th className="text-right">Credits</Th><Th className="text-right">Balance</Th></tr></thead>
            <tbody>
              {platform.map((r) => <tr key={r.code}><Td>{r.name}<span className="block font-mono text-[11px] text-ink-muted">{r.code}</span></Td><Td className="tabular text-right">{formatMoney(r.debit)}</Td><Td className="tabular text-right">{formatMoney(r.credit)}</Td><Td className="tabular text-right font-medium">{formatMoney(r.type === "ASSET" || r.type === "EXPENSE" ? r.debit - r.credit : r.credit - r.debit)}</Td></tr>)}
              <tr><Td className="font-medium">Vendor pending (all)</Td><Td /><Td /><Td className="tabular text-right font-medium">{formatMoney(sumBucket("pending"))}</Td></tr>
              <tr><Td className="font-medium">Vendor available (all)</Td><Td /><Td /><Td className="tabular text-right font-medium">{formatMoney(sumBucket("available"))}</Td></tr>
              <tr><Td className="font-medium">Vendor withdrawals in progress</Td><Td /><Td /><Td className="tabular text-right font-medium">{formatMoney(sumBucket("payout_hold"))}</Td></tr>
              <tr><Td className="font-semibold">Trial balance</Td><Td className="tabular text-right font-semibold">{formatMoney(td)}</Td><Td className="tabular text-right font-semibold">{formatMoney(tc)}</Td><Td className={`text-right font-semibold ${td === tc ? "text-success" : "text-danger"}`}>{td === tc ? "Balanced" : "Unbalanced"}</Td></tr>
            </tbody>
          </Table>
        </div>
        <div>
          <h2 className="mb-3 font-semibold">Commission rules</h2>
          <p className="mb-3 text-[13px] text-ink-muted">Most specific rule wins: product › vendor › category › plan › global. Changes apply to new orders only.</p>
          <Table><thead><tr><Th>Scope</Th><Th>Applies to</Th><Th className="text-right">Rate</Th><Th /></tr></thead>
            <tbody>{rules.map((r) => <tr key={r.id}><Td>{r.scope.toLowerCase()}</Td><Td>{r.category?.name ?? r.vendor?.store?.name ?? r.vendor?.businessName ?? r.planKey ?? "Everything"}</Td><Td className="tabular text-right">{r.rateBps / 100}%{r.fixedMinor > 0n ? ` + ${formatMoney(r.fixedMinor)}` : ""}</Td><Td>{u.permissions.has("commission.manage") && r.scope !== "GLOBAL" && <form action={deactivateCommissionRuleAction}><input type="hidden" name="id" value={r.id} /><button className="text-[12px] text-ink-muted hover:text-danger">Disable</button></form>}</Td></tr>)}</tbody>
          </Table>
          {u.permissions.has("commission.manage") && (
            <form action={saveCommissionRuleAction} className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-line bg-white p-4 text-sm">
              <Select name="scope" defaultValue="CATEGORY" aria-label="Scope"><option value="GLOBAL">Global default</option><option value="CATEGORY">Category</option><option value="VENDOR">Vendor</option></Select>
              <Select name="targetId" defaultValue="" aria-label="Target"><option value="">— target (not for global) —</option><optgroup label="Categories">{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup><optgroup label="Vendors">{vendors.map((v) => <option key={v.id} value={v.id}>{v.businessName}</option>)}</optgroup></Select>
              <Input name="name" placeholder="Rule name" required />
              <div className="flex gap-2"><Input name="rate" type="number" step="0.01" min={0} max={50} placeholder="%" required aria-label="Rate %" /><Input name="fixed" type="number" step="0.01" min={0} placeholder="₦ fixed" aria-label="Fixed naira per item" /></div>
              <SubmitButton size="sm" className="col-span-2">Save rule</SubmitButton>
            </form>
          )}
        </div>
      </section>
    </>
  );
}
