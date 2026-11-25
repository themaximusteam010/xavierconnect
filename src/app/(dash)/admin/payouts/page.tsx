import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { adapterName } from "@/server/services/payouts";
import { approvePayoutAction, simulatePayoutCallbackAction } from "@/app/actions/admin-ops";
import { payoutDecisionAction } from "@/app/actions/admin";
import { resolveRange } from "@/components/admin/date-range";
import { FilterBar, qs } from "@/components/admin/filters";
import { Kpi, Panel } from "@/components/admin/charts";
import { PageHeader } from "@/components/ui/page-header";
import { Alert, Badge, FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { formatMoney } from "@/lib/money";
import { countryName } from "@/lib/countries";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Payouts" };
type SP = { status?: string; country?: string; currency?: string; provider?: string; range?: string; from?: string; to?: string; id?: string; ok?: string; error?: string; page?: string };

export default async function Payouts({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await guard("finance.view");
  const sp = await searchParams;
  const r = resolveRange(sp, "90d");
  const page = Math.max(1, Number(sp.page) || 1);
  const canPay = u.permissions.has("finance.payout.approve");
  const where: Prisma.PayoutWhereInput = {
    createdAt: { gte: r.from, lt: r.to },
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(sp.country ? { vendor: { country: sp.country } } : {}),
    ...(sp.currency ? { settlementCurrency: sp.currency } : {}),
    ...(sp.provider ? { providerKey: sp.provider } : {}),
  };
  const [rows, total, byStatus, selected] = await Promise.all([
    db.payout.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { vendor: { select: { businessName: true, country: true } }, beneficiary: true } }),
    db.payout.count({ where }),
    db.payout.groupBy({ by: ["status"], where, _sum: { amountMinor: true }, _count: true }),
    sp.id ? db.payout.findUnique({ where: { id: sp.id }, include: { vendor: true, beneficiary: true, events: { orderBy: { createdAt: "asc" } }, fxQuote: true } }) : null,
  ]);
  const s = (k: string) => byStatus.find((x) => x.status === k);
  return (
    <>
      <PageHeader title="Payouts" description={`${r.label} · vendor withdrawals. A payout sent through a provider is marked paid only when the provider confirms.`} actions={<ButtonLink variant="secondary" href={qs("/admin-export/payouts", { ...sp, id: undefined, ok: undefined, error: undefined })}>Export CSV</ButtonLink>} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Awaiting approval" value={s("REQUESTED")?._count ?? 0} sub={formatMoney(s("REQUESTED")?._sum.amountMinor ?? 0n)} tone={(s("REQUESTED")?._count ?? 0) ? "warning" : undefined} />
        <Kpi label="With provider" value={s("PROCESSING")?._count ?? 0} sub={formatMoney(s("PROCESSING")?._sum.amountMinor ?? 0n)} />
        <Kpi label="Approved (manual)" value={s("APPROVED")?._count ?? 0} sub={formatMoney(s("APPROVED")?._sum.amountMinor ?? 0n)} />
        <Kpi label="Paid" value={formatMoney(s("PAID")?._sum.amountMinor ?? 0n)} sub={`${s("PAID")?._count ?? 0} payouts`} tone="success" />
        <Kpi label="Failed / rejected" value={(s("FAILED")?._count ?? 0) + (s("REJECTED")?._count ?? 0)} tone={(s("FAILED")?._count ?? 0) ? "danger" : undefined} />
      </div>

      {selected && (
        <Panel title={`Payout ${selected.id}`} className="mb-6" action={<Link href={qs("/admin/payouts", { ...sp, id: undefined, ok: undefined, error: undefined })} className="text-[12px] text-ink-muted">Close</Link>}>
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4 text-[13px]">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                {[["Vendor", `${selected.vendor.businessName} (${countryName(selected.vendor.country)})`], ["Beneficiary", selected.beneficiary ? `${selected.beneficiary.verifiedName ?? selected.beneficiary.accountHolderName}` : "Legacy account"], ["Bank", selected.beneficiary ? `${selected.beneficiary.bankName} ••••${selected.beneficiary.accountLast4} (${selected.beneficiary.routingType})` : "—"], ["Provider", adapterName(selected.providerKey)], ["Method", selected.method === "CROSS_BORDER" ? "Cross-border" : "Local"], ["Amount (ledger)", `${formatMoney(selected.amountMinor)} NGN`], ["Settlement", selected.settlementAmountMinor != null ? `${(Number(selected.settlementAmountMinor) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })} ${selected.settlementCurrency}` : selected.settlementCurrency ?? "—"], ["FX rate", selected.fxRate ? `${selected.fxRate.toString()} ${selected.settlementCurrency}/NGN` : "—"], ["Provider fee", formatMoney(selected.providerFeeMinor)], ["Provider reference", selected.providerRef ?? "—"], ["Initiated", selected.initiatedAt?.toLocaleString("en-NG") ?? "—"], ["Completed", selected.paidAt?.toLocaleString("en-NG") ?? "—"]].map(([k, v]) => <div key={k}><dt className="text-ink-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}
              </dl>
              {selected.failureReason && <Alert tone="danger" title="Failure reason">{selected.failureReason}</Alert>}
              {selected.fxQuote && <p className="text-ink-muted">FX quote {selected.fxQuote.providerQuoteRef ?? selected.fxQuote.id}: {formatMoney(selected.fxQuote.sourceAmountMinor)} − fee {formatMoney(selected.fxQuote.feeMinor)} at {selected.fxQuote.rate.toString()} = {(Number(selected.fxQuote.targetAmountMinor) / 100).toFixed(2)} {selected.fxQuote.targetCurrency}; expires {selected.fxQuote.expiresAt.toLocaleString("en-NG")} ({selected.fxQuote.status.toLowerCase()}).</p>}
              <ol className="space-y-1 border-l border-line pl-4">{selected.events.map((e) => <li key={e.id}><span className="tabular text-ink-muted">{e.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "medium" })}</span> · <span className="font-medium">{e.status.toLowerCase().replace(/_/g, " ")}</span>{e.message && ` — ${e.message}`}</li>)}</ol>
            </div>
            {canPay && (
              <div className="space-y-3">
                {selected.status === "REQUESTED" && (
                  <>
                    <form action={approvePayoutAction}><input type="hidden" name="id" value={selected.id} /><SubmitButton className="w-full" confirm={`Send ${formatMoney(selected.amountMinor)} to ${selected.vendor.businessName}${selected.method === "CROSS_BORDER" ? " (a fresh FX quote will be taken)" : ""}?`}>{selected.providerKey === "manual" ? "Approve for bank transfer" : "Approve and send to provider"}</SubmitButton></form>
                    <form action={payoutDecisionAction} className="flex gap-2"><input type="hidden" name="id" value={selected.id} /><input type="hidden" name="op" value="rejected" /><Input name="reason" placeholder="Reason for rejecting" className="h-9" required /><SubmitButton size="sm" variant="secondary" className="h-9">Reject</SubmitButton></form>
                  </>
                )}
                {selected.status === "APPROVED" && selected.providerKey === "manual" && (
                  <form action={payoutDecisionAction} className="space-y-2"><input type="hidden" name="id" value={selected.id} /><input type="hidden" name="op" value="paid" /><Input name="ref" placeholder="Bank transfer reference" required /><SubmitButton className="w-full" confirm="Confirm the bank transfer has been completed?">Record bank transfer</SubmitButton></form>
                )}
                {selected.status === "PROCESSING" && selected.providerKey?.startsWith("sandbox-") && (
                  <div className="rounded-md border border-amber-200 bg-warning-soft p-3">
                    <p className="mb-2 text-[12px] text-warning">Sandbox: deliver the simulator's callback through the webhook pipeline.</p>
                    <form action={simulatePayoutCallbackAction} className="flex gap-2"><input type="hidden" name="id" value={selected.id} /><SubmitButton name="outcome" value="SUCCESS" size="sm">Provider: success</SubmitButton><SubmitButton name="outcome" value="FAILED" size="sm" variant="secondary">Provider: failed</SubmitButton></form>
                  </div>
                )}
                {selected.status === "PROCESSING" && !selected.providerKey?.startsWith("sandbox-") && <p className="text-[13px] text-ink-muted">Waiting for {adapterName(selected.providerKey)} to confirm. It can't be marked paid manually.</p>}
              </div>
            )}
          </div>
        </Panel>
      )}

      <FilterBar action="/admin/payouts" values={sp} fields={[
        { type: "select", name: "status", label: "Status", options: [["REQUESTED", "Awaiting approval"], ["APPROVED", "Approved (manual)"], ["PROCESSING", "With provider"], ["PAID", "Paid"], ["FAILED", "Failed"], ["REJECTED", "Rejected"]] },
        { type: "select", name: "country", label: "Vendor country", options: [["NG", "Nigeria"], ["CN", "China"], ["GH", "Ghana"], ["KE", "Kenya"], ["ZA", "South Africa"], ["GB", "United Kingdom"], ["US", "United States"]] },
        { type: "select", name: "currency", label: "Settlement currency", options: [["NGN", "NGN"], ["CNY", "CNY"], ["USD", "USD"], ["GBP", "GBP"]] },
        { type: "select", name: "provider", label: "Provider", options: [["manual", "Manual transfer"], ["paystack", "Paystack"], ["sandbox-payouts", "Sandbox domestic"], ["sandbox-crossborder", "Sandbox cross-border"]] },
        { type: "range" },
      ]} />
      <Table>
        <thead><tr><Th>Vendor</Th><Th>Beneficiary / bank</Th><Th>Provider</Th><Th className="text-right">Amount</Th><Th className="text-right">Settlement</Th><Th>FX rate</Th><Th className="text-right">Fee</Th><Th>Reference</Th><Th>Status</Th><Th>Initiated</Th><Th>Completed</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={11} className="py-8 text-center text-ink-muted">No payouts match.</Td></tr>}
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-canvas">
              <Td><Link href={qs("/admin/payouts", { ...sp, id: p.id, ok: undefined, error: undefined })} className="font-medium text-ink hover:text-brand">{p.vendor.businessName}</Link><span className="block text-[11px] text-ink-muted">{countryName(p.vendor.country)}</span></Td>
              <Td>{p.beneficiary ? <>{p.beneficiary.verifiedName ?? p.beneficiary.accountHolderName}<span className="block text-[11px] text-ink-muted">{p.beneficiary.bankName} ••••{p.beneficiary.accountLast4}</span></> : "—"}</Td>
              <Td>{adapterName(p.providerKey)}{p.providerKey?.startsWith("sandbox-") && <Badge tone="warning" className="ml-1">sandbox</Badge>}</Td>
              <Td className="tabular text-right">{formatMoney(p.amountMinor)}</Td>
              <Td className="tabular text-right">{p.settlementAmountMinor != null ? `${(Number(p.settlementAmountMinor) / 100).toFixed(2)} ${p.settlementCurrency}` : p.settlementCurrency}</Td>
              <Td className="tabular">{p.fxRate?.toString() ?? "—"}</Td>
              <Td className="tabular text-right">{p.providerFeeMinor > 0n ? formatMoney(p.providerFeeMinor) : "—"}</Td>
              <Td className="font-mono text-[11px]">{p.providerRef ?? "—"}</Td>
              <Td><StatusBadge status={p.status} />{p.failureReason && <span className="block max-w-36 truncate text-[11px] text-danger" title={p.failureReason}>{p.failureReason}</span>}</Td>
              <Td className="whitespace-nowrap">{(p.initiatedAt ?? p.createdAt).toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td>
              <Td className="whitespace-nowrap">{p.paidAt?.toLocaleDateString("en-NG", { dateStyle: "medium" }) ?? "—"}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(n) => qs("/admin/payouts", { ...sp, page: n, ok: undefined, error: undefined })} />
    </>
  );
}
