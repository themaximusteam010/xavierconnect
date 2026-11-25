import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { decideDisputeAction, staffDisputeNoteAction } from "@/app/actions/admin-ops";
import { FilterBar, qs } from "@/components/admin/filters";
import { Panel } from "@/components/admin/charts";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, StatusBadge, Badge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Disputes" };

export default async function Disputes({ searchParams }: { searchParams: Promise<{ status?: string; id?: string; ok?: string; error?: string }> }) {
  await guard("dispute.decide");
  const sp = await searchParams;
  const open = ["OPEN", "AWAITING_VENDOR", "UNDER_REVIEW"];
  const [rows, sel] = await Promise.all([
    db.dispute.findMany({ where: sp.status === "closed" ? { status: { notIn: open as never } } : { status: { in: open as never } }, orderBy: { createdAt: "asc" }, take: 200, include: { vendorOrder: { select: { number: true, totalMinor: true, vendor: { select: { businessName: true } } } }, openedBy: { select: { name: true } } } }),
    sp.id ? db.dispute.findUnique({ where: { id: sp.id }, include: { evidence: { orderBy: { createdAt: "asc" } }, vendorOrder: { include: { vendor: true, items: true, shipments: true } }, order: true, openedBy: { select: { name: true, email: true } } } }) : null,
  ]);
  return (
    <>
      <PageHeader title="Disputes" description="An open dispute holds the vendor's earnings for that sub-order until an authorised decision is recorded." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      {sel && (
        <Panel title={`${sel.reason} · ${sel.vendorOrder.number}`} className="mb-6" action={<Link href="/admin/disputes" className="text-[12px] text-ink-muted">Close</Link>}>
          <div className="grid gap-6 text-[13px] lg:grid-cols-[1fr_340px]">
            <div className="space-y-3">
              <p><StatusBadge status={sel.status} /> Opened by {sel.openedBy.name} ({sel.openedBy.email}) on {sel.createdAt.toLocaleString("en-NG")}</p>
              <p className="text-ink-muted">Vendor {sel.vendorOrder.vendor.businessName} · amount {formatMoney(sel.vendorOrder.totalMinor)} · fulfilment {sel.vendorOrder.status.toLowerCase()} · evidence {sel.vendorOrder.deliveryEvidence?.toLowerCase().replace(/_/g, " ") ?? "none"}</p>
              <ol className="space-y-3">{sel.evidence.map((e) => <li key={e.id} className={`rounded-md border p-3 ${e.party === "VENDOR" ? "border-blue-200 bg-brand-soft/40" : e.party === "STAFF" ? "border-amber-200 bg-warning-soft" : "border-line"}`}><p className="mb-1 text-[11px] text-ink-muted">{e.party.toLowerCase()} · {e.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</p><p className="whitespace-pre-line">{e.body}</p></li>)}</ol>
              {sel.resolution && <p><span className="font-medium">Resolution:</span> {sel.resolution}</p>}
            </div>
            {open.includes(sel.status) && (
              <div className="space-y-4">
                <form action={staffDisputeNoteAction} className="space-y-2"><input type="hidden" name="id" value={sel.id} /><Textarea name="body" rows={3} placeholder="Internal note or request for information" /><SubmitButton size="sm" variant="secondary">Add note</SubmitButton></form>
                <form action={decideDisputeAction} className="space-y-2 rounded-md bg-canvas p-3"><input type="hidden" name="id" value={sel.id} /><p className="font-medium">Decision</p><Textarea name="resolution" rows={3} placeholder="Reasoning (shared with both parties)" required /><div className="flex gap-2"><SubmitButton name="outcome" value="REFUND_CUSTOMER" size="sm" variant="danger" confirm={`Refund ${formatMoney(sel.vendorOrder.totalMinor)} to the customer?`}>Refund customer</SubmitButton><SubmitButton name="outcome" value="RELEASE_VENDOR" size="sm" confirm="Decide for the vendor and release the hold?">Decide for vendor</SubmitButton></div></form>
              </div>
            )}
          </div>
        </Panel>
      )}
      <FilterBar action="/admin/disputes" values={sp} fields={[{ type: "select", name: "status", label: "Show", options: [["closed", "Closed / decided"]] }]} />
      <Table>
        <thead><tr><Th>Sub-order</Th><Th>Vendor</Th><Th>Customer</Th><Th>Reason</Th><Th>Age</Th><Th>Status</Th><Th className="text-right">Amount</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={7} className="py-8 text-center text-ink-muted">No disputes.</Td></tr>}
          {rows.map((d) => (
            <tr key={d.id} className="hover:bg-canvas">
              <Td><Link href={qs("/admin/disputes", { ...sp, id: d.id, ok: undefined, error: undefined })} className="font-medium text-ink hover:text-brand">{d.vendorOrder.number}</Link></Td>
              <Td>{d.vendorOrder.vendor.businessName}</Td><Td>{d.openedBy.name}</Td><Td>{d.reason}</Td>
              <Td>{Math.floor((Date.now() - d.createdAt.getTime()) / 864e5)} days {Date.now() - d.createdAt.getTime() > 3 * 864e5 && open.includes(d.status) && <Badge tone="warning">overdue</Badge>}</Td>
              <Td><StatusBadge status={d.status} /></Td><Td className="tabular text-right">{formatMoney(d.vendorOrder.totalMinor)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
