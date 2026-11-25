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
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { FilterBar, qs } from "@/components/admin/filters";
import { runReconciliationAction } from "@/app/actions/admin-ops";

export const metadata = { title: "Finance" };

export default async function Finance({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; tab?: string; q?: string; status?: string; page?: string }> }) {
  const u = await guard("finance.view");
  const sp = await searchParams;
  const nav = (
    <nav className="mb-6 flex gap-1 border-b border-line text-sm">{[["", "Overview"], ["ledger", "Ledger transactions"], ["reconciliation", "Reconciliation"]].map(([k, l]) => <Link key={k} href={k ? `/admin/finance?tab=${k}` : "/admin/finance"} className={`-mb-px border-b-2 px-3 py-2 ${(sp.tab ?? "") === k ? "border-ink font-medium" : "border-transparent text-ink-muted hover:text-ink"}`}>{l}</Link>)}</nav>
  );
  if (sp.tab === "ledger") return <><PageHeader title="Finance" description="Ledger transactions are append-only. Corrections are made with new reversing entries, never by editing history." actions={<ButtonLink variant="secondary" href="/admin-export/ledger?range=90d">Export ledger (90 days)</ButtonLink>} />{nav}<LedgerTab sp={sp} /></>;
  if (sp.tab === "reconciliation") return <><PageHeader title="Finance" description="Re-checks recent payments and payouts against the provider." actions={<form action={runReconciliationAction}><SubmitButton variant="secondary">Run reconciliation now</SubmitButton></form>} /><FlashFromQuery ok={sp.ok} error={sp.error} />{nav}<ReconTab sp={sp} /></>;
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
      {nav}
      {td !== tc && <Alert tone="danger" title="Ledger out of balance" className="mb-6">Debits {formatMoney(td)} ≠ credits {formatMoney(tc)}. Investigate immediately.</Alert>}
      {failedRefunds.length > 0 && <Alert tone="warning" title={`${failedRefunds.length} refund(s) need attention`} className="mb-6">{failedRefunds.map((r) => `${r.order.number} (${r.reason})`).join(", ")}</Alert>}

      <section className="mb-10 rounded-lg border border-line bg-white p-4 text-sm">
        <h2 className="mb-1 font-semibold">Withdrawal requests</h2>
        <p className="text-ink-muted">{payouts.length} payout(s) awaiting action. Approve, send and reconcile them on the <Link href="/admin/payouts?status=REQUESTED" className="text-brand underline">Payouts</Link> page.</p>
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

async function LedgerTab({ sp }: { sp: { q?: string; page?: string } }) {
  const page = Math.max(1, Number(sp.page) || 1);
  const where = sp.q ? { OR: [{ reference: { contains: sp.q } }, { kind: { contains: sp.q.toUpperCase() } }] } : {};
  const [txs, total] = await Promise.all([
    db.ledgerTransaction.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30, include: { entries: { include: { account: { select: { code: true } } } } } }),
    db.ledgerTransaction.count({ where }),
  ]);
  return (
    <>
      <FilterBar action="/admin/finance" values={sp} fields={[{ type: "search", name: "q", placeholder: "Reference or kind (e.g. PAYOUT)" }]} extra={<input type="hidden" name="tab" value="ledger" />} />
      <div className="space-y-3">{txs.map((t) => (
        <div key={t.id} className="rounded-lg border border-line bg-white text-[13px]">
          <p className="flex flex-wrap justify-between gap-2 border-b border-line px-4 py-2"><span><span className="font-medium">{t.kind}</span> · {t.reference} · {t.description}</span><span className="text-ink-muted">{t.createdAt.toLocaleString("en-NG")}</span></p>
          <table className="w-full"><tbody>{t.entries.map((e) => <tr key={e.id}><td className="px-4 py-1 font-mono text-[12px]">{e.account.code}</td><td className="tabular px-4 py-1 text-right">{e.debitMinor ? formatMoney(e.debitMinor) : ""}</td><td className="tabular px-4 py-1 text-right">{e.creditMinor ? formatMoney(e.creditMinor) : ""}</td></tr>)}</tbody></table>
        </div>
      ))}</div>
      <Pagination page={page} pages={Math.ceil(total / 30)} href={(n) => qs("/admin/finance", { ...sp, tab: "ledger", page: n })} />
    </>
  );
}

async function ReconTab({ sp }: { sp: { status?: string; page?: string } }) {
  const page = Math.max(1, Number(sp.page) || 1);
  const where = sp.status ? { status: sp.status } : {};
  const [rows, total, summary] = await Promise.all([
    db.reconciliationRecord.findMany({ where, orderBy: { runAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
    db.reconciliationRecord.count({ where }),
    db.reconciliationRecord.groupBy({ by: ["status"], where: { runAt: { gte: new Date(Date.now() - 7 * 864e5) } }, _count: true }),
  ]);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2 text-[13px]">{summary.map((s) => <span key={s.status} className={`rounded-full border px-3 py-1 ${s.status === "MATCHED" ? "border-line" : "border-amber-300 bg-warning-soft"}`}>{s.status.toLowerCase().replace(/_/g, " ")}: {s._count} (7 days)</span>)}</div>
      <FilterBar action="/admin/finance" values={sp} fields={[{ type: "select", name: "status", label: "Result", options: [["MATCHED", "Matched"], ["AMOUNT_MISMATCH", "Amount mismatch"], ["STATUS_MISMATCH", "Status mismatch"], ["MISSING_AT_PROVIDER", "Missing at provider"], ["UNVERIFIABLE", "Unverifiable (manual)"]] }]} extra={<input type="hidden" name="tab" value="reconciliation" />} />
      <Table>
        <thead><tr><Th>Checked</Th><Th>Provider</Th><Th>Kind</Th><Th>Reference</Th><Th className="text-right">Internal</Th><Th className="text-right">Provider</Th><Th>Result</Th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><Td colSpan={7} className="py-6 text-center text-ink-muted">No reconciliation results yet. The scheduled job runs daily.</Td></tr> : rows.map((r) => (
          <tr key={r.id}><Td>{r.runAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</Td><Td>{r.providerKey}</Td><Td>{r.kind.toLowerCase()}</Td><Td className="font-mono text-[12px]">{r.reference}</Td>
            <Td className="tabular text-right">{r.internalAmountMinor != null ? formatMoney(r.internalAmountMinor) : "—"}</Td><Td className="tabular text-right">{r.providerAmountMinor != null ? formatMoney(r.providerAmountMinor) : "—"}</Td>
            <Td><span className={r.status === "MATCHED" ? "text-success" : r.status === "UNVERIFIABLE" ? "text-ink-muted" : "text-danger"}>{r.status.toLowerCase().replace(/_/g, " ")}</span>{r.detail && <span className="block text-[11px] text-ink-muted">{r.detail}</span>}</Td></tr>
        ))}</tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(n) => qs("/admin/finance", { ...sp, tab: "reconciliation", page: n })} />
    </>
  );
}
