import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { shippingProviderName, STATUS_LABEL } from "@/server/services/shipping";
import { SHIPPING_ADAPTERS } from "@/server/integrations/registry";
import { adminCancelShipmentAction, adminDecideReturnAction, adminRefreshTrackingAction } from "@/app/actions/shipping-ops";
import { simulateTrackingAction } from "@/app/actions/admin-ops";
import { FilterBar, qs } from "@/components/admin/filters";
import { Panel } from "@/components/admin/charts";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { formatMoney } from "@/lib/money";
import { countryName } from "@/lib/countries";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Shipments" };
type SP = { tab?: string; leg?: string; status?: string; provider?: string; intl?: string; stale?: string; q?: string; id?: string; page?: string; ok?: string; error?: string };

export default async function Shipments({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await guard("order.view_all");
  const sp = await searchParams;
  if (sp.tab === "returns") return <Returns sp={sp} can={u.permissions.has("order.manage")} />;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.ShipmentWhereInput = {
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(sp.provider ? (sp.provider === "vendor" ? { providerKey: null } : { providerKey: sp.provider }) : {}),
    ...(sp.leg ? { leg: sp.leg } : {}),
    ...(sp.intl ? { international: sp.intl === "1" } : {}),
    ...(sp.stale ? { status: { in: ["IN_TRANSIT", "PICKED_UP", "OUT_FOR_DELIVERY"] }, OR: [{ lastEventAt: { lt: new Date(Date.now() - 5 * 864e5) } }, { lastEventAt: null, createdAt: { lt: new Date(Date.now() - 5 * 864e5) } }] } : {}),
    ...(sp.q ? { OR: [{ trackingNumber: { contains: sp.q } }, { vendorOrder: { number: { contains: sp.q.toUpperCase() } } }] } : {}),
  };
  const [rows, total, sel] = await Promise.all([
    db.shipment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { vendorOrder: { select: { number: true, vendor: { select: { businessName: true } } } } } }),
    db.shipment.count({ where }),
    sp.id ? db.shipment.findUnique({ where: { id: sp.id }, include: { events: { orderBy: { createdAt: "asc" } }, customs: true, labels: true, items: { include: { orderItem: { select: { name: true } } } }, consolidation: { select: { id: true, reference: true } }, vendorOrder: { include: { vendor: true, order: true } } } }) : null,
  ]);
  return (
    <>
      <PageHeader title="Shipments" actions={<><ButtonLink variant="secondary" href="/admin/shipments?tab=returns">Returns</ButtonLink><ButtonLink variant="secondary" href={qs("/admin-export/shipments", { ...sp, id: undefined, page: undefined })}>Export CSV</ButtonLink></>} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      {sel && (
        <Panel title={`Shipment ${sel.trackingNumber ?? sel.id} · ${sel.vendorOrder.number}`} className="mb-6" action={<Link href={qs("/admin/shipments", { ...sp, id: undefined, ok: undefined, error: undefined })} className="text-[12px] text-ink-muted">Close</Link>}>
          <div className="grid gap-6 text-[13px] lg:grid-cols-2">
            <div className="space-y-2">
              <p><span className="text-ink-muted">Carrier: </span>{sel.carrier} ({shippingProviderName(sel.providerKey)}){sel.service && ` · ${sel.service}`}</p>
              <p><span className="text-ink-muted">Leg: </span>{sel.leg.toLowerCase().replace(/_/g, " ")}{sel.method && ` · ${sel.method.toLowerCase().replace(/_/g, " ")}`}{sel.consolidation && <> · <Link href={`/admin/freight?tab=consolidations&id=${sel.consolidation.id}`} className="text-brand underline">{sel.consolidation.reference}</Link></>}</p>
              <p><span className="text-ink-muted">Charged to customer: </span>{formatMoney(sel.vendorOrder.shippingMinor)}{sel.vendorOrder.shippingCostMinor != null && <> · carrier cost {formatMoney(sel.vendorOrder.shippingCostMinor)}</>}</p>
              {sel.estimatedDeliveryAt && <p><span className="text-ink-muted">Carrier estimate: </span>{sel.estimatedDeliveryAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</p>}
              {sel.pickupScheduledAt && <p><span className="text-ink-muted">Pickup: </span>{sel.pickupScheduledAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}{sel.pickupRef && ` (${sel.pickupRef})`}</p>}
              {sel.cancelReason && <p className="text-danger">Cancelled: {sel.cancelReason}</p>}
              {sel.items.length > 0 && <p><span className="text-ink-muted">Contents: </span>{sel.items.map((i) => `${i.quantity} × ${i.orderItem.name}`).join(", ")}</p>}
              {(sel.labelUrl || sel.labels.length > 0) && <p><span className="text-ink-muted">Labels: </span>{[...(sel.labelUrl ? [sel.labelUrl] : []), ...sel.labels.filter((l) => l.url && l.url !== sel.labelUrl).map((l) => l.url!)].map((url, i) => <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="mr-2 text-brand underline">label {i + 1}</a>)}</p>}
              <p><span className="text-ink-muted">Route: </span>{countryName(sel.originCountry)} → {countryName(sel.destinationCountry)}{sel.international && <Badge tone="info" className="ml-2">international</Badge>}</p>
              {sel.costMinor != null && <p><span className="text-ink-muted">Label cost: </span>{formatMoney(sel.costMinor)} {sel.costCurrency}</p>}
              {sel.trackingUrl && <p><a href={sel.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-brand underline">Carrier tracking page</a></p>}
              {sel.recipientName && <p><span className="text-ink-muted">Proof of delivery: </span>received by {sel.recipientName}</p>}
              <p><span className="text-ink-muted">Sub-order evidence: </span>{sel.vendorOrder.deliveryEvidence?.toLowerCase().replace(/_/g, " ") ?? "none yet"}</p>
              {sel.customs && (
                <div className="mt-3 rounded-md bg-canvas p-3">
                  <p className="font-medium">Customs declaration</p>
                  <p>{sel.customs.contents} · declared {formatMoney(sel.customs.declaredValueMinor)} {sel.customs.currency} · origin {countryName(sel.customs.originCountry)}</p>
                  <p>HS codes: {sel.customs.hsCodes.join(", ") || "—"} · {sel.customs.incoterm === "DAP" ? "Duties paid by recipient (DAP)" : "Duties paid by sender (DDP)"} · {sel.customs.insured ? "insured" : "not insured"}</p>
                </div>
              )}
            </div>
            <div>
              <ol className="space-y-1.5 border-l border-line pl-4">{sel.events.map((e) => <li key={e.id}><span className="tabular text-ink-muted">{e.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</span> · <span className="font-medium">{e.status.toLowerCase().replace(/_/g, " ")}</span>{e.note && ` — ${e.note}`}{e.location && ` (${e.location})`}</li>)}</ol>
              {u.permissions.has("order.manage") && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {sel.providerKey && sel.providerShipmentId && !["DELIVERED", "CANCELLED", "RETURNED"].includes(sel.status) && <form action={adminRefreshTrackingAction}><input type="hidden" name="id" value={sel.id} /><SubmitButton size="sm" variant="secondary">Refresh tracking from carrier</SubmitButton></form>}
                  {["PENDING", "AWAITING_PICKUP"].includes(sel.status) && <form action={adminCancelShipmentAction} className="flex gap-1"><input type="hidden" name="id" value={sel.id} /><Input name="reason" placeholder="Reason" required className="h-8 w-44" /><SubmitButton size="sm" variant="ghost" confirm="Cancel this shipment with the carrier?">Cancel shipment</SubmitButton></form>}
                </div>
              )}
              {sel.providerKey === "sandbox-shipping" && u.permissions.has("order.manage") && !["DELIVERED", "RETURNED"].includes(sel.status) && (
                <form action={simulateTrackingAction} className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-warning-soft p-3">
                  <input type="hidden" name="id" value={sel.id} />
                  <span className="text-[12px] text-warning">Sandbox carrier event:</span>
                  <Select name="status" className="h-8 w-44 text-[12px]"><option value="PICKED_UP">Picked up</option><option value="IN_TRANSIT">In transit</option><option value="OUT_FOR_DELIVERY">Out for delivery</option><option value="DELIVERED">Delivered</option><option value="FAILED_ATTEMPT">Failed attempt</option></Select>
                  <SubmitButton size="sm">Send</SubmitButton>
                </form>
              )}
            </div>
          </div>
        </Panel>
      )}
      <FilterBar action="/admin/shipments" values={sp} fields={[
        { type: "search", name: "q", placeholder: "Tracking or sub-order number" },
        { type: "select", name: "status", label: "Status", options: Object.entries(STATUS_LABEL) },
        { type: "select", name: "provider", label: "Carrier", options: [["vendor", "Seller delivery"], ...SHIPPING_ADAPTERS.map((a) => [a.key, a.name] as [string, string])] },
        { type: "select", name: "leg", label: "Leg", options: [["DIRECT", "Direct"], ["TO_WAREHOUSE", "To origin warehouse"], ["CONSOLIDATED", "Consolidated freight"], ["LAST_MILE", "Last mile"], ["RETURN", "Return"]] },
        { type: "select", name: "intl", label: "Scope", options: [["0", "Domestic"], ["1", "International"]] },
      ]} />
      <Table>
        <thead><tr><Th>Sub-order</Th><Th>Vendor</Th><Th>Carrier</Th><Th>Tracking</Th><Th>Route</Th><Th>Status</Th><Th>Last update</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={7} className="py-8 text-center text-ink-muted">No shipments match.</Td></tr>}
          {rows.map((s) => (
            <tr key={s.id} className="hover:bg-canvas">
              <Td><Link href={qs("/admin/shipments", { ...sp, id: s.id, ok: undefined, error: undefined })} className="font-medium text-ink hover:text-brand">{s.vendorOrder.number}</Link></Td>
              <Td>{s.vendorOrder.vendor.businessName}</Td>
              <Td>{s.carrier}<span className="block text-[11px] text-ink-muted">{shippingProviderName(s.providerKey)}</span></Td>
              <Td className="font-mono text-[12px]">{s.trackingNumber ?? "—"}</Td>
              <Td>{s.originCountry ?? "—"} → {s.destinationCountry ?? "NG"}</Td>
              <Td><StatusBadge status={s.status} /></Td>
              <Td className="whitespace-nowrap">{(s.lastEventAt ?? s.updatedAt).toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(n) => qs("/admin/shipments", { ...sp, page: n, ok: undefined, error: undefined })} />
    </>
  );
}

const RETURN_STATUSES = ["REQUESTED", "APPROVED", "IN_TRANSIT", "RECEIVED", "REFUNDED", "REJECTED"];
async function Returns({ sp, can }: { sp: SP; can: boolean }) {
  const status = RETURN_STATUSES.includes(sp.status ?? "") ? sp.status! : undefined;
  const rows = await db.shippingReturn.findMany({ where: status ? { status } : { status: { in: ["REQUESTED", "APPROVED", "IN_TRANSIT", "RECEIVED"] } }, orderBy: { createdAt: "asc" }, take: 200, include: { vendorOrder: { select: { number: true, totalMinor: true, vendor: { select: { businessName: true } } } }, returnShipment: { select: { carrier: true, trackingNumber: true } } } });
  return (
    <>
      <PageHeader title="Returns" description="Customer return requests. Sellers decide first; staff can step in. Settlement for the sub-order is paused while a return is open." actions={<ButtonLink variant="secondary" href="/admin/shipments">Shipments</ButtonLink>} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <nav className="mb-4 flex flex-wrap gap-2 text-[13px]"><Link href="/admin/shipments?tab=returns" className={!status ? "font-medium" : "text-ink-muted"}>Open</Link>{RETURN_STATUSES.map((s) => <Link key={s} href={`/admin/shipments?tab=returns&status=${s}`} className={status === s ? "font-medium" : "text-ink-muted"}>{s.toLowerCase().replace(/_/g, " ")}</Link>)}</nav>
      <Table>
        <thead><tr><Th>Requested</Th><Th>Sub-order</Th><Th>Seller</Th><Th>Reason</Th><Th>Status</Th><Th>Return parcel</Th><Th>Action</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={7} className="py-8 text-center text-ink-muted">No returns.</Td></tr>}
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <Td className="whitespace-nowrap">{r.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td>
              <Td className="font-medium">{r.vendorOrder.number}<span className="block text-[11px] text-ink-muted">{formatMoney(r.vendorOrder.totalMinor)}</span></Td>
              <Td>{r.vendorOrder.vendor.businessName}</Td>
              <Td className="max-w-64 text-[12px]">{r.reason}{r.details && <span className="block text-ink-muted">{r.details}</span>}{r.decisionNote && <span className="block">Decision: {r.decisionNote}</span>}</Td>
              <Td><StatusBadge status={r.status} /></Td>
              <Td className="text-[12px]">{r.returnShipment ? <>{r.returnShipment.carrier}<span className="block font-mono">{r.returnShipment.trackingNumber}</span></> : "—"}</Td>
              <Td>{can && ["REQUESTED", "APPROVED", "IN_TRANSIT", "RECEIVED"].includes(r.status) && (
                <form action={adminDecideReturnAction} className="flex flex-wrap gap-1">
                  <input type="hidden" name="id" value={r.id} />
                  <Input name="note" placeholder="Note" className="h-8 w-36" />
                  {r.status === "REQUESTED" && <><SubmitButton size="sm" name="decision" value="approve">Approve</SubmitButton><SubmitButton size="sm" variant="ghost" name="decision" value="reject">Reject</SubmitButton></>}
                  {["APPROVED", "IN_TRANSIT", "RECEIVED"].includes(r.status) && <SubmitButton size="sm" name="decision" value="refund" confirm="Confirm the item is back with the seller and refund the customer for this sub-order?">Received · refund</SubmitButton>}
                </form>
              )}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
