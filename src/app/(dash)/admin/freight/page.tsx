import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { SHIPPING_ADAPTERS } from "@/server/integrations/registry";
import { CONSOLIDATION_FLOW, CONSOLIDATION_LABEL } from "@/server/services/freight";
import { addShippingInvoiceAction, addToConsolidationAction, advanceConsolidationAction, confirmFinalDeliveryAction, createConsolidationAction, dispatchLastMileAction, partnerQuoteAction, receiptExceptionAction, receiveParcelAction, saveWarehouseAction } from "@/app/actions/shipping-ops";
import { PageHeader } from "@/components/ui/page-header";
import { Alert, Badge, FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Kpi } from "@/components/admin/charts";
import { minorToDecimal } from "@/lib/csv";

export const metadata = { title: "International freight" };
const TABS: [string, string][] = [["consolidations", "Consolidations"], ["receiving", "Warehouse receiving"], ["lastmile", "Last mile"], ["warehouses", "Warehouses"], ["invoices", "Freight invoices"]];
const partners = () => SHIPPING_ADAPTERS.filter((a) => a.profile.freightModes.includes("AIR") || a.profile.freightModes.includes("SEA"));
const dt = (d: Date | null | undefined) => d?.toLocaleDateString("en-NG", { dateStyle: "medium" }) ?? "—";

export default async function Freight({ searchParams }: { searchParams: Promise<{ tab?: string; id?: string; ok?: string; error?: string; edit?: string }> }) {
  const u = await guard("order.view_all");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "consolidations";
  const can = u.permissions.has("order.manage");
  const [expected, received, open, inTransit] = await Promise.all([
    db.warehouseReceipt.count({ where: { status: "EXPECTED" } }), db.warehouseReceipt.count({ where: { status: "RECEIVED" } }),
    db.freightConsolidation.count({ where: { status: { in: ["OPEN", "BOOKED"] } } }), db.freightConsolidation.count({ where: { status: { in: ["DEPARTED", "ARRIVED", "CUSTOMS", "CLEARED", "LAST_MILE"] } } }),
  ]);
  return (
    <>
      <PageHeader title="International freight" description="China (and other origins) → Nigeria: supplier parcels into the origin warehouse, air or sea consolidations with a freight partner, Nigerian customs and last-mile delivery. Charges are only what the partner quotes or invoices." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Parcels expected at warehouse" value={expected} /><Kpi label="Received, not consolidated" value={received} tone={received ? "warning" : undefined} />
        <Kpi label="Open consolidations" value={open} /><Kpi label="In transit / customs / last mile" value={inTransit} />
      </div>
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line text-sm">{TABS.map(([k, l]) => <Link key={k} href={`/admin/freight?tab=${k}`} className={`-mb-px shrink-0 border-b-2 px-3 py-2 ${tab === k ? "border-ink font-medium" : "border-transparent text-ink-muted hover:text-ink"}`}>{l}</Link>)}</nav>
      {tab === "warehouses" && <Warehouses can={can} edit={sp.edit} />}
      {tab === "receiving" && <Receiving can={can} />}
      {tab === "consolidations" && <Consolidations can={can} id={sp.id} canQuote={u.permissions.has("finance.view")} />}
      {tab === "lastmile" && <LastMile can={can} />}
      {tab === "invoices" && <Invoices can={u.permissions.has("finance.view")} />}
    </>
  );
}

async function Warehouses({ can, edit }: { can: boolean; edit?: string }) {
  const list = await db.warehouse.findMany({ orderBy: [{ role: "asc" }, { code: "asc" }], include: { _count: { select: { receipts: true } } } });
  const e = list.find((w) => w.id === edit);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <Table>
        <thead><tr><Th>Code</Th><Th>Warehouse</Th><Th>Role</Th><Th>Partner</Th><Th className="text-right">Parcels</Th><Th /></tr></thead>
        <tbody>
          {list.length === 0 && <tr><Td colSpan={6} className="py-6 text-center text-ink-muted">No warehouses yet. Add the partner&apos;s origin warehouse (e.g. Guangzhou) with the exact address the partner gives you.</Td></tr>}
          {list.map((w) => <tr key={w.id}><Td className="font-mono">{w.code}</Td><Td>{w.name}<span className="block text-[12px] text-ink-muted">{w.city}, {w.country} · {w.address}</span></Td><Td>{w.role.toLowerCase()}{!w.active && <Badge className="ml-1">off</Badge>}</Td><Td>{SHIPPING_ADAPTERS.find((a) => a.key === w.partnerKey)?.name ?? "—"}</Td><Td className="tabular text-right">{w._count.receipts}</Td><Td><Link href={`/admin/freight?tab=warehouses&edit=${w.id}`} className="text-[12px] text-brand">Edit</Link></Td></tr>)}
        </tbody>
      </Table>
      {can && (
        <form action={saveWarehouseAction} key={e?.id ?? "new"} className="h-fit space-y-2 rounded-lg border border-line bg-white p-4 text-[13px]">
          <p className="font-semibold">{e ? `Edit ${e.code}` : "Add warehouse"}</p>
          {e && <input type="hidden" name="id" value={e.id} />}
          <div className="grid grid-cols-2 gap-2"><label>Code<Input name="code" defaultValue={e?.code} required placeholder="CN-GZ-1" /></label><label>Role<Select name="role" defaultValue={e?.role ?? "ORIGIN"}><option value="ORIGIN">Origin</option><option value="DESTINATION">Destination hub</option></Select></label></div>
          <label className="block">Name<Input name="name" defaultValue={e?.name} required /></label>
          <div className="grid grid-cols-2 gap-2"><label>Country (ISO)<Input name="country" defaultValue={e?.country ?? "CN"} required maxLength={2} /></label><label>City<Input name="city" defaultValue={e?.city} required /></label></div>
          <label className="block">Address (as given by the partner)<Textarea name="address" rows={3} defaultValue={e?.address} required /></label>
          <div className="grid grid-cols-2 gap-2"><label>Contact<Input name="contactName" defaultValue={e?.contactName ?? ""} /></label><label>Phone<Input name="phone" defaultValue={e?.phone ?? ""} /></label></div>
          <label className="block">Operated by<Select name="partnerKey" defaultValue={e?.partnerKey ?? ""}><option value="">—</option>{partners().map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></label>
          <label className="block">Notes for vendors<Input name="notes" defaultValue={e?.notes ?? ""} placeholder="e.g. write your shipping mark on every carton" /></label>
          <Checkbox name="active" label="Active" defaultChecked={e?.active ?? true} />
          <SubmitButton size="sm">Save warehouse</SubmitButton>
        </form>
      )}
    </div>
  );
}

async function Receiving({ can }: { can: boolean }) {
  const rows = await db.warehouseReceipt.findMany({ where: { status: { in: ["EXPECTED", "RECEIVED", "EXCEPTION"] } }, orderBy: { createdAt: "asc" }, take: 200, include: { warehouse: true } });
  const vos = await db.vendorOrder.findMany({ where: { id: { in: rows.map((r) => r.vendorOrderId) } }, select: { id: true, number: true, vendor: { select: { businessName: true } } } });
  return (
    <Table>
      <thead><tr><Th>Sub-order</Th><Th>Vendor</Th><Th>Warehouse</Th><Th>Inbound</Th><Th>Status</Th><Th>Receive / exception</Th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><Td colSpan={6} className="py-6 text-center text-ink-muted">Nothing waiting at the warehouses.</Td></tr>}
        {rows.map((r) => { const vo = vos.find((v) => v.id === r.vendorOrderId); return (
          <tr key={r.id} className="align-top">
            <Td className="font-medium">{vo?.number}</Td><Td>{vo?.vendor.businessName}</Td><Td className="font-mono text-[12px]">{r.warehouse.code}</Td>
            <Td className="text-[12px]">{r.inboundCarrier ?? "—"}<span className="block font-mono">{r.inboundTracking ?? ""}</span>{r.pieces} piece(s)</Td>
            <Td><Badge tone={r.status === "EXCEPTION" ? "danger" : r.status === "RECEIVED" ? "success" : "warning"}>{r.status.toLowerCase()}</Badge>{r.weightGrams && <span className="block text-[11px] text-ink-muted">{(r.weightGrams / 1000).toFixed(2)} kg · {r.lengthCm}×{r.widthCm}×{r.heightCm} cm</span>}{r.exceptionNote && <span className="block text-[11px] text-danger">{r.exceptionNote}</span>}</Td>
            <Td>{can && r.status === "EXPECTED" && (
              <div className="space-y-1.5">
                <form action={receiveParcelAction} className="flex flex-wrap items-center gap-1"><input type="hidden" name="id" value={r.id} /><Input name="weightKg" placeholder="kg" inputMode="decimal" className="h-8 w-16" required /><Input name="lengthCm" placeholder="L" className="h-8 w-14" required /><Input name="widthCm" placeholder="W" className="h-8 w-14" required /><Input name="heightCm" placeholder="H" className="h-8 w-14" required /><Input name="pieces" defaultValue={r.pieces} className="h-8 w-12" /><SubmitButton size="sm">Received</SubmitButton></form>
                <form action={receiptExceptionAction} className="flex gap-1"><input type="hidden" name="id" value={r.id} /><Input name="note" placeholder="Damaged / missing / wrong mark" className="h-8 w-52" /><SubmitButton size="sm" variant="ghost">Exception</SubmitButton></form>
              </div>
            )}</Td>
          </tr>
        ); })}
      </tbody>
    </Table>
  );
}

async function Consolidations({ can, canQuote, id }: { can: boolean; canQuote: boolean; id?: string }) {
  const [list, warehouses] = await Promise.all([
    db.freightConsolidation.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { _count: { select: { shipments: true } } } }),
    db.warehouse.findMany({ where: { role: "ORIGIN", active: true } }),
  ]);
  const sel = id ? await db.freightConsolidation.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "asc" } }, shipments: { include: { vendorOrder: { select: { number: true, vendor: { select: { businessName: true } } } } } }, invoices: true } }) : null;
  const ready = sel ? await db.warehouseReceipt.findMany({ where: { status: "RECEIVED", warehouseId: sel.originWarehouseId } }) : [];
  const readyVos = ready.length ? await db.vendorOrder.findMany({ where: { id: { in: ready.map((r) => r.vendorOrderId) } }, select: { id: true, number: true } }) : [];
  const next = sel && sel.status !== "CANCELLED" ? CONSOLIDATION_FLOW[CONSOLIDATION_FLOW.indexOf(sel.status as (typeof CONSOLIDATION_FLOW)[number]) + 1] : undefined;
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <div className="space-y-4">
        <Table>
          <thead><tr><Th>Reference</Th><Th>Mode</Th><Th>Partner</Th><Th>Parcels</Th><Th>Status</Th><Th>Partner ref</Th><Th>ETA</Th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><Td colSpan={7} className="py-6 text-center text-ink-muted">No consolidations yet.</Td></tr>}
            {list.map((c) => <tr key={c.id} className={sel?.id === c.id ? "bg-brand-soft/40" : "hover:bg-canvas"}><Td><Link href={`/admin/freight?tab=consolidations&id=${c.id}`} className="font-medium hover:text-brand">{c.reference}</Link></Td><Td>{c.mode.toLowerCase()}</Td><Td>{SHIPPING_ADAPTERS.find((a) => a.key === c.partnerKey)?.name}</Td><Td className="tabular">{c._count.shipments}</Td><Td><Badge tone={c.status === "CLOSED" ? "success" : c.status === "CANCELLED" ? "neutral" : "info"}>{CONSOLIDATION_LABEL[c.status]}</Badge></Td><Td className="font-mono text-[12px]">{c.partnerReference ?? "—"}</Td><Td>{dt(c.eta)}</Td></tr>)}
          </tbody>
        </Table>
        {sel && (
          <section className="rounded-lg border border-line bg-white p-4 text-[13px]">
            <h2 className="mb-2 font-semibold">{sel.reference} · {sel.mode === "AIR" ? "Air" : "Sea"} freight</h2>
            <p className="mb-3">Partner quote: {sel.quotedCostMinor != null ? <span className="font-medium">{sel.quotedCurrency} {minorToDecimal(sel.quotedCostMinor)}</span> : <span className="text-ink-muted">not recorded</span>}{sel.quoteIncludes && <> · includes {sel.quoteIncludes}</>}{sel.quoteExcludes && <span className="block text-warning">Excludes: {sel.quoteExcludes}</span>}</p>
            <Table>
              <thead><tr><Th>Sub-order</Th><Th>Vendor</Th><Th>Leg status</Th><Th className="text-right">kg</Th></tr></thead>
              <tbody>{sel.shipments.map((s) => <tr key={s.id}><Td>{s.vendorOrder.number}</Td><Td>{s.vendorOrder.vendor.businessName}</Td><Td><StatusBadge status={s.status} /></Td><Td className="tabular text-right">{s.weightGrams ? (s.weightGrams / 1000).toFixed(2) : "—"}</Td></tr>)}</tbody>
            </Table>
            <ol className="mt-3 space-y-1 border-l border-line pl-3">{sel.events.map((e) => <li key={e.id}><span className="text-ink-muted">{e.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</span> · {CONSOLIDATION_LABEL[e.status] ?? e.status}{e.note && ` — ${e.note}`}{e.location && ` (${e.location})`}</li>)}</ol>
          </section>
        )}
      </div>
      <div className="space-y-4">
        {can && (
          <form action={createConsolidationAction} className="space-y-2 rounded-lg border border-line bg-white p-4 text-[13px]">
            <p className="font-semibold">Open a consolidation</p>
            {warehouses.length === 0 ? <Alert tone="warning">Add an origin warehouse first.</Alert> : <>
              <div className="grid grid-cols-2 gap-2"><label>Mode<Select name="mode"><option value="AIR">Air</option><option value="SEA">Sea</option></Select></label><label>Origin<Select name="warehouseId">{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}</Select></label></div>
              <label className="block">Freight partner<Select name="partnerKey">{partners().map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></label>
              <SubmitButton size="sm">Open</SubmitButton>
            </>}
          </form>
        )}
        {sel && can && ["OPEN", "BOOKED"].includes(sel.status) && (
          <form action={addToConsolidationAction} className="space-y-2 rounded-lg border border-line bg-white p-4 text-[13px]">
            <input type="hidden" name="id" value={sel.id} />
            <p className="font-semibold">Add received parcels</p>
            {ready.length === 0 ? <p className="text-ink-muted">No received parcels waiting at this warehouse.</p> : <>{ready.map((r) => <label key={r.id} className="flex items-center gap-2"><input type="checkbox" name="receipts" value={r.id} /> {readyVos.find((v) => v.id === r.vendorOrderId)?.number} · {r.weightGrams ? `${(r.weightGrams / 1000).toFixed(2)} kg` : ""}</label>)}<SubmitButton size="sm" variant="secondary">Add to {sel.reference}</SubmitButton></>}
          </form>
        )}
        {sel && canQuote && (
          <form action={partnerQuoteAction} className="space-y-2 rounded-lg border border-line bg-white p-4 text-[13px]">
            <input type="hidden" name="id" value={sel.id} />
            <p className="font-semibold">Partner quote (exactly as quoted)</p>
            <div className="grid grid-cols-2 gap-2"><label>Amount<Input name="amount" inputMode="decimal" required defaultValue={sel.quotedCostMinor != null ? minorToDecimal(sel.quotedCostMinor) : ""} /></label><label>Currency<Input name="currency" defaultValue={sel.quotedCurrency ?? "NGN"} maxLength={3} /></label></div>
            <label className="block">Includes<Input name="includes" defaultValue={sel.quoteIncludes ?? ""} placeholder="freight, origin handling, clearance…" /></label>
            <label className="block">Excludes (required)<Input name="excludes" defaultValue={sel.quoteExcludes ?? ""} required placeholder="Nigerian import duty & VAT, storage/demurrage…" /></label>
            <SubmitButton size="sm" variant="secondary">Save quote</SubmitButton>
          </form>
        )}
        {sel && can && next && (
          <form action={advanceConsolidationAction} className="space-y-2 rounded-lg border border-line bg-white p-4 text-[13px]">
            <input type="hidden" name="id" value={sel.id} /><input type="hidden" name="to" value={next} />
            <p className="font-semibold">Next milestone: {CONSOLIDATION_LABEL[next]}</p>
            {next === "BOOKED" && <><label className="block">Partner reference (AWB / B/L)<Input name="partnerReference" required /></label><div className="grid grid-cols-2 gap-2"><label>ETD<Input name="etd" type="date" /></label><label>ETA<Input name="eta" type="date" /></label></div></>}
            <label className="block">Note<Input name="note" placeholder="optional" /></label>
            <label className="block">Location<Input name="location" placeholder="optional" /></label>
            <SubmitButton size="sm">Mark {CONSOLIDATION_LABEL[next].toLowerCase()}</SubmitButton>
          </form>
        )}
        {sel && can && ["OPEN", "BOOKED"].includes(sel.status) && (
          <form action={advanceConsolidationAction} className="rounded-lg border border-line bg-white p-4 text-[13px]"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="to" value="CANCELLED" /><Input name="note" placeholder="Reason" className="mb-2" /><SubmitButton size="sm" variant="ghost" confirm="Cancel this consolidation? Parcels return to the warehouse list.">Cancel consolidation</SubmitButton></form>
        )}
      </div>
    </div>
  );
}

async function LastMile({ can }: { can: boolean }) {
  const [toDispatch, out] = await Promise.all([
    db.shipment.findMany({ where: { leg: "CONSOLIDATED", status: { not: "DELIVERED" }, consolidation: { status: { in: ["CLEARED", "LAST_MILE"] } } }, include: { vendorOrder: { select: { number: true, order: { select: { shippingAddress: true } } } }, consolidation: { select: { reference: true } } } }),
    db.shipment.findMany({ where: { leg: "LAST_MILE", status: { notIn: ["DELIVERED", "CANCELLED"] } }, include: { vendorOrder: { select: { number: true } } } }),
  ]);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section><h2 className="mb-2 font-semibold">Cleared — ready to dispatch</h2>
        <ul className="space-y-2">{toDispatch.length === 0 && <li className="text-sm text-ink-muted">Nothing waiting.</li>}{toDispatch.map((s) => { const a = s.vendorOrder.order.shippingAddress as { city?: string; state?: string } | null; return (
          <li key={s.id} className="rounded-lg border border-line bg-white p-3 text-[13px]"><p className="font-medium">{s.vendorOrder.number} · {s.consolidation?.reference} → {a?.city}, {a?.state}</p>
            {can && <form action={dispatchLastMileAction} className="mt-2 flex flex-wrap gap-1"><input type="hidden" name="id" value={s.id} /><Input name="carrier" placeholder="Courier / rider" className="h-8 w-36" required /><Input name="trackingNumber" placeholder="Tracking no." className="h-8 w-32" /><Input name="trackingUrl" placeholder="https://tracking link" className="h-8 w-48" /><SubmitButton size="sm">Dispatch</SubmitButton></form>}
          </li>); })}</ul>
      </section>
      <section><h2 className="mb-2 font-semibold">Out for delivery</h2>
        <ul className="space-y-2">{out.length === 0 && <li className="text-sm text-ink-muted">Nothing out for delivery.</li>}{out.map((s) => (
          <li key={s.id} className="rounded-lg border border-line bg-white p-3 text-[13px]"><p className="font-medium">{s.vendorOrder.number} · {s.carrier} {s.trackingNumber ?? ""}</p>
            {can && <form action={confirmFinalDeliveryAction} className="mt-2 flex gap-1"><input type="hidden" name="id" value={s.id} /><Input name="recipient" placeholder="Received by" className="h-8 w-44" required /><SubmitButton size="sm" confirm="Confirm delivery? This is delivery evidence for the seller's settlement.">Delivered</SubmitButton></form>}
          </li>))}</ul>
      </section>
    </div>
  );
}

async function Invoices({ can }: { can: boolean }) {
  const [list, cons] = await Promise.all([db.shippingInvoice.findMany({ orderBy: { issuedAt: "desc" }, take: 200, include: { consolidation: { select: { reference: true } } } }), db.freightConsolidation.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, reference: true } })]);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Table>
        <thead><tr><Th>Issued</Th><Th>Provider</Th><Th>Invoice</Th><Th>For</Th><Th className="text-right">Amount</Th><Th>Status</Th></tr></thead>
        <tbody>{list.length === 0 && <tr><Td colSpan={6} className="py-6 text-center text-ink-muted">No invoices recorded.</Td></tr>}{list.map((i) => <tr key={i.id}><Td>{dt(i.issuedAt)}</Td><Td>{SHIPPING_ADAPTERS.find((a) => a.key === i.providerKey)?.name ?? i.providerKey}</Td><Td className="font-mono text-[12px]">{i.invoiceNumber}</Td><Td>{i.consolidation?.reference ?? (i.shipmentId ? "shipment" : "—")}</Td><Td className="tabular text-right">{i.currency} {minorToDecimal(i.amountMinor)}</Td><Td>{i.status.toLowerCase()}</Td></tr>)}</tbody>
      </Table>
      {can && (
        <form action={addShippingInvoiceAction} className="h-fit space-y-2 rounded-lg border border-line bg-white p-4 text-[13px]">
          <p className="font-semibold">Record a provider invoice</p>
          <label className="block">Provider<Select name="providerKey">{SHIPPING_ADAPTERS.filter((a) => a.profile.category !== "TEST").map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></label>
          <div className="grid grid-cols-2 gap-2"><label>Invoice no.<Input name="invoiceNumber" required /></label><label>Issued<Input name="issuedAt" type="date" required /></label></div>
          <div className="grid grid-cols-2 gap-2"><label>Amount<Input name="amount" inputMode="decimal" required /></label><label>Currency<Input name="currency" defaultValue="NGN" maxLength={3} /></label></div>
          <label className="block">Consolidation<Select name="consolidationId"><option value="">—</option>{cons.map((c) => <option key={c.id} value={c.id}>{c.reference}</option>)}</Select></label>
          <label className="block">Note<Input name="note" /></label>
          <SubmitButton size="sm">Save invoice</SubmitButton>
        </form>
      )}
    </div>
  );
}
