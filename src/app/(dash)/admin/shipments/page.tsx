import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { shippingProviderName } from "@/server/services/shipping";
import { simulateTrackingAction } from "@/app/actions/admin-ops";
import { FilterBar, qs } from "@/components/admin/filters";
import { Panel } from "@/components/admin/charts";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { formatMoney } from "@/lib/money";
import { countryName } from "@/lib/countries";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Shipments" };
type SP = { status?: string; provider?: string; intl?: string; stale?: string; q?: string; id?: string; page?: string; ok?: string; error?: string };

export default async function Shipments({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await guard("order.view_all");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.ShipmentWhereInput = {
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(sp.provider ? (sp.provider === "vendor" ? { providerKey: null } : { providerKey: sp.provider }) : {}),
    ...(sp.intl ? { international: sp.intl === "1" } : {}),
    ...(sp.stale ? { status: { in: ["IN_TRANSIT", "PICKED_UP", "OUT_FOR_DELIVERY"] }, OR: [{ lastEventAt: { lt: new Date(Date.now() - 5 * 864e5) } }, { lastEventAt: null, createdAt: { lt: new Date(Date.now() - 5 * 864e5) } }] } : {}),
    ...(sp.q ? { OR: [{ trackingNumber: { contains: sp.q } }, { vendorOrder: { number: { contains: sp.q.toUpperCase() } } }] } : {}),
  };
  const [rows, total, sel] = await Promise.all([
    db.shipment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { vendorOrder: { select: { number: true, vendor: { select: { businessName: true } } } } } }),
    db.shipment.count({ where }),
    sp.id ? db.shipment.findUnique({ where: { id: sp.id }, include: { events: { orderBy: { createdAt: "asc" } }, customs: true, vendorOrder: { include: { vendor: true, order: true } } } }) : null,
  ]);
  return (
    <>
      <PageHeader title="Shipments" actions={<ButtonLink variant="secondary" href={qs("/admin-export/shipments", { ...sp, id: undefined, page: undefined })}>Export CSV</ButtonLink>} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      {sel && (
        <Panel title={`Shipment ${sel.trackingNumber ?? sel.id} · ${sel.vendorOrder.number}`} className="mb-6" action={<Link href={qs("/admin/shipments", { ...sp, id: undefined, ok: undefined, error: undefined })} className="text-[12px] text-ink-muted">Close</Link>}>
          <div className="grid gap-6 text-[13px] lg:grid-cols-2">
            <div className="space-y-2">
              <p><span className="text-ink-muted">Carrier: </span>{sel.carrier} ({shippingProviderName(sel.providerKey)}){sel.service && ` · ${sel.service}`}</p>
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
        { type: "select", name: "status", label: "Status", options: [["PENDING", "Label created"], ["PICKED_UP", "Picked up"], ["IN_TRANSIT", "In transit"], ["OUT_FOR_DELIVERY", "Out for delivery"], ["DELIVERED", "Delivered"], ["FAILED_ATTEMPT", "Failed attempt"], ["RETURNED", "Returned"]] },
        { type: "select", name: "provider", label: "Carrier", options: [["vendor", "Vendor delivery"], ["sandbox-shipping", "Sandbox carrier"], ["shipbubble", "Shipbubble"]] },
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
