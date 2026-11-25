import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Panel } from "@/components/admin/charts";
import { formatMoney } from "@/lib/money";

export default async function PaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  await guard("finance.view");
  const { id } = await params;
  const p = await db.payment.findUnique({ where: { id }, include: { refunds: true, order: { include: { user: { select: { email: true } }, vendorOrders: { include: { vendor: { select: { businessName: true, country: true } } } } } } } });
  if (!p) notFound();
  const [events, ledger, recon] = await Promise.all([
    db.paymentEvent.findMany({ where: { provider: p.provider, payload: { path: ["normalised", "reference"], equals: p.reference } }, orderBy: { createdAt: "asc" } }),
    db.ledgerTransaction.findMany({ where: { reference: { startsWith: p.order.number } }, orderBy: { createdAt: "asc" }, include: { entries: { include: { account: true } } } }),
    db.reconciliationRecord.findMany({ where: { reference: p.reference }, orderBy: { runAt: "desc" }, take: 5 }),
  ]);
  const row = (k: string, v: React.ReactNode) => <div className="grid grid-cols-[150px_1fr] gap-2 py-1.5"><dt className="text-ink-muted">{k}</dt><dd>{v}</dd></div>;
  return (
    <>
      <PageHeader eyebrow="Payment" title={p.reference} description={<span className="flex items-center gap-2"><StatusBadge status={p.status} /> {p.provider} · {formatMoney(p.amountMinor)} {p.currency}</span>} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Transaction">
          <dl className="text-[13px]">
            {row("Order", <Link href={`/admin/orders/${p.order.number}`} className="text-brand">{p.order.number}</Link>)}
            {row("Customer", p.order.user?.email ?? `${p.order.guestEmail} (guest)`)}
            {row("Provider / channel", `${p.provider}${p.channel ? ` · ${p.channel}` : ""}`)}
            {row("Amount", `${formatMoney(p.amountMinor)} ${p.currency}`)}
            {row("Processing fees", formatMoney(p.feesMinor))}
            {row("Verified", p.verifiedAt?.toLocaleString("en-NG") ?? "—")}
            {row("Failure reason", p.failureReason ?? "—")}
            {row("Order totals", `items ${formatMoney(p.order.subtotalMinor)} · discount ${formatMoney(p.order.discountMinor)} · shipping ${formatMoney(p.order.shippingMinor)} · tax ${formatMoney(p.order.taxMinor)}`)}
          </dl>
        </Panel>
        <Panel title="Vendor sub-orders">
          <ul className="divide-y divide-line text-[13px]">
            {p.order.vendorOrders.map((v) => (
              <li key={v.id} className="py-2">
                <div className="flex justify-between"><span className="font-medium">{v.number} · {v.vendor.businessName} ({v.vendor.country})</span><StatusBadge status={v.status} /></div>
                <p className="tabular text-ink-muted">Total {formatMoney(v.totalMinor)} · commission {formatMoney(v.commissionMinor)} · vendor net {formatMoney(v.vendorNetMinor)} · settles in {v.settlementCurrency} · {v.settledAt ? `settled ${v.settledAt.toLocaleDateString("en-NG")}` : v.deliveryEvidence ? `delivered (${v.deliveryEvidence.toLowerCase().replace(/_/g, " ")})` : "awaiting delivery"}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Provider webhook events">
          {events.length === 0 ? <p className="text-[13px] text-ink-muted">No webhook events recorded for this reference.{p.provider === "sandbox" ? " Sandbox payments are confirmed on redirect." : ""}</p> : (
            <ul className="space-y-1.5 text-[13px]">{events.map((e) => <li key={e.id}><span className="tabular text-ink-muted">{e.createdAt.toLocaleString("en-NG")}</span> {e.type} · {e.processedAt ? "processed" : e.deadLetteredAt ? "dead-lettered" : `pending (attempt ${e.attempts})`}{e.error && <span className="block text-danger">{e.error}</span>}</li>)}</ul>
          )}
        </Panel>
        <Panel title="Refunds and reconciliation">
          <ul className="space-y-1.5 text-[13px]">
            {p.refunds.map((r) => <li key={r.id}>Refund {formatMoney(r.amountMinor)} · <StatusBadge status={r.status} /> · {r.reason}{r.providerRef && <span className="font-mono text-[11px]"> · {r.providerRef}</span>}</li>)}
            {recon.map((r) => <li key={r.id}>Reconciled {r.runAt.toLocaleString("en-NG")}: <StatusBadge status={r.status === "MATCHED" ? "COMPLETED" : r.status === "UNVERIFIABLE" ? "PENDING_REVIEW" : "FAILED"} /> {r.status.toLowerCase().replace(/_/g, " ")} {r.detail && `— ${r.detail}`}</li>)}
            {p.refunds.length === 0 && recon.length === 0 && <li className="text-ink-muted">No refunds; not yet reconciled.</li>}
          </ul>
        </Panel>
      </div>
      <h2 className="mb-2 mt-6 text-[13px] font-semibold">Ledger entries (immutable)</h2>
      <Table>
        <thead><tr><Th>When</Th><Th>Transaction</Th><Th>Account</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th></tr></thead>
        <tbody>{ledger.flatMap((t) => t.entries.map((e, i) => <tr key={e.id}><Td>{i === 0 ? t.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" }) : ""}</Td><Td>{i === 0 ? t.kind : ""}</Td><Td className="font-mono text-[12px]">{e.account.code}</Td><Td className="tabular text-right">{e.debitMinor > 0n ? formatMoney(e.debitMinor) : ""}</Td><Td className="tabular text-right">{e.creditMinor > 0n ? formatMoney(e.creditMinor) : ""}</Td></tr>))}</tbody>
      </Table>
    </>
  );
}
