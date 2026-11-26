import Link from "next/link";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { SHIPPING_ADAPTERS } from "@/server/integrations/registry";
import { shippingProviderName, STATUS_LABEL } from "@/server/services/shipping";
import { vendorCancelShipmentAction, vendorPickupAction, vendorRefreshTrackingAction, vendorRegisterInboundAction } from "@/app/actions/shipping-ops";
import { buyLabelAction, quoteShipmentAction } from "@/app/actions/vendor-finance";
import { PageHeader } from "@/components/ui/page-header";
import { Alert, Badge, FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Checkbox, Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { countryName } from "@/lib/countries";
import { formatMoney, minorToInput } from "@/lib/money";

export const metadata = { title: "Shipments" };

export default async function VendorShipments({ searchParams }: { searchParams: Promise<{ order?: string; ok?: string; error?: string }> }) {
  const { vendorId, vendor } = await requireVendor("orders");
  const sp = await searchParams;
  const [toShip, shipments, pickups, activeProviders] = await Promise.all([
    db.vendorOrder.findMany({ where: { vendorId, status: { in: ["NEW", "PROCESSING", "READY_FOR_DISPATCH"] }, items: { some: { kind: "PHYSICAL" } } }, orderBy: { createdAt: "asc" }, include: { order: { select: { number: true, shippingAddress: true } } } }),
    db.shipment.findMany({ where: { vendorOrder: { vendorId } }, orderBy: { createdAt: "desc" }, take: 100, include: { vendorOrder: { select: { id: true, number: true } }, labels: true } }),
    db.pickupAddress.findMany({ where: { vendorId }, orderBy: { isDefault: "desc" } }),
    db.integrationProvider.findMany({ where: { kind: "SHIPPING", active: true }, select: { key: true } }),
  ]);
  const sel = sp.order ? await db.vendorOrder.findFirst({ where: { id: sp.order, vendorId }, include: { items: true, order: { select: { number: true, shippingAddress: true } }, shipments: true } }) : null;
  const dest = ((sel?.order.shippingAddress as { country?: string } | null)?.country) ?? "NG";
  const origin = pickups[0]?.country ?? vendor.country;
  const carriers = SHIPPING_ADAPTERS.filter((a) => activeProviders.some((p) => p.key === a.key) && a.capabilities.includes("RATE_QUOTE") && a.routes.includes(`${origin}>${dest}`));
  const quotes = sel ? await db.shippingQuote.findMany({ where: { vendorId, vendorOrderId: sel.id, expiresAt: { gt: new Date() } }, orderBy: { amountMinor: "asc" } }) : [];
  const international = origin !== dest;
  const warehouses = sel && vendor.country !== dest ? await db.warehouse.findMany({ where: { role: "ORIGIN", active: true, country: vendor.country } }) : [];
  const chosen = sel?.shippingQuoteId ? quotes.find((q) => q.id === sel.shippingQuoteId) ?? null : null;
  const chosenExpired = !!sel?.shippingQuoteId && !chosen;
  const today = new Date().toISOString().slice(0, 10);
  const physicalValue = sel ? sel.items.filter((i) => i.kind === "PHYSICAL").reduce((a, i) => a + i.unitPriceMinor * BigInt(i.quantity), 0n) : 0n;
  return (
    <>
      <PageHeader title="Shipments" description="Buy carrier labels for paid orders, or add your own tracking on the order page." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      {sel && (
        <section className="mb-8 rounded-lg border border-line bg-white p-4 text-[13px]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">Ship {sel.number}</h2><span className="text-ink-muted">{countryName(origin)} → {countryName(dest)} {international && <Badge tone="info">international</Badge>}</span></div>
          {chosen && <Alert tone="info" className="mb-3">The customer chose <span className="font-medium">{chosen.courierName}</span> ({shippingProviderName(chosen.providerKey)}) at checkout and paid {formatMoney(sel.shippingMinor)} for delivery. Book that rate below — it is preselected.</Alert>}
          {chosenExpired && <Alert tone="warning" className="mb-3">The courier rate the customer chose at checkout has expired. Get fresh rates; if the new price is higher, contact support before booking.</Alert>}
          {warehouses.length > 0 && !sel.shipments.some((s) => !["CANCELLED", "RETURNED"].includes(s.status)) && (
            <form action={vendorRegisterInboundAction} className="mb-4 space-y-2 rounded-md border border-line bg-canvas p-3">
              <input type="hidden" name="vendorOrderId" value={sel.id} />
              <p className="font-semibold">Send to the consolidation warehouse</p>
              <p className="text-[12px] text-ink-muted">XavierConnect consolidates parcels from {countryName(vendor.country)} and ships them to Nigeria with a freight partner. Send this order to the warehouse and enter your local courier&apos;s tracking number.</p>
              <ul className="text-[12px]">{warehouses.map((w) => <li key={w.id}><span className="font-medium">{w.name}</span> · {w.address}, {w.city}{w.phone && ` · ${w.phone}`}{w.notes && <span className="block text-warning">{w.notes}</span>}</li>)}</ul>
              <div className="flex flex-wrap items-end gap-2">
                <label>Warehouse<Select name="warehouseId">{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}</Select></label>
                <label>Local courier<Input name="carrier" placeholder="e.g. SF Express" /></label>
                <label>Tracking no.<Input name="tracking" /></label>
                <label>Cartons<Input name="pieces" type="number" min={1} defaultValue={1} className="w-20" /></label>
                <SubmitButton size="sm" variant="secondary">Register parcel</SubmitButton>
              </div>
            </form>
          )}
          {sel.shipments.some((s) => s.providerKey && !["CANCELLED", "RETURNED"].includes(s.status)) ? <Alert>A carrier label already exists for this order. Track it below.</Alert>
            : pickups.length === 0 ? <Alert tone="warning">Add a pickup address on <Link href="/vendor/shipping" className="underline">Shipping</Link> first.</Alert>
            : carriers.length === 0 ? <Alert tone="warning">No integrated carrier serves {countryName(origin)} → {countryName(dest)} yet. Ship with your own courier and add the tracking number on the <Link href={`/vendor/orders/${sel.id}`} className="underline">order page</Link>.</Alert>
            : (
              <>
                <form action={quoteShipmentAction} className="mb-4 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="vendorOrderId" value={sel.id} />
                  <label>Carrier<Select name="providerKey">{carriers.map((c) => <option key={c.key} value={c.key}>{c.name}{c.status === "SANDBOX_SIMULATOR" ? " (test)" : ""}</option>)}</Select></label>
                  <label>Pickup from<Select name="pickupAddressId">{pickups.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.city}</option>)}</Select></label>
                  <label>L (cm)<Input name="length" type="number" min={1} max={300} defaultValue={30} className="w-20" /></label>
                  <label>W (cm)<Input name="width" type="number" min={1} max={300} defaultValue={20} className="w-20" /></label>
                  <label>H (cm)<Input name="height" type="number" min={1} max={300} defaultValue={15} className="w-20" /></label>
                  <SubmitButton size="sm" variant="secondary">Get rates</SubmitButton>
                </form>
                {quotes.length > 0 && (
                  <form action={buyLabelAction} className="space-y-3">
                    <input type="hidden" name="vendorOrderId" value={sel.id} />
                    <input type="hidden" name="international" value={international ? "1" : "0"} />
                    <ul className="space-y-1">{quotes.map((q, i) => <li key={q.id}><label className="flex items-center gap-2"><input type="radio" name="quoteId" value={q.id} defaultChecked={chosen ? q.id === chosen.id : i === 0} required /> <span className="font-medium">{q.courierName}</span>{q.id === chosen?.id && <Badge tone="brand">customer&apos;s choice</Badge>} · {q.currency === "NGN" ? formatMoney(q.amountMinor) : `${q.currency} ${minorToInput(q.amountMinor)}`}{q.etaText && <span className="text-ink-muted"> · {q.etaText}</span>} <span className="text-[11px] text-ink-muted">({shippingProviderName(q.providerKey)})</span></label></li>)}</ul>
                    {international && (
                      <fieldset className="grid gap-3 rounded-md bg-canvas p-3 sm:grid-cols-2">
                        <legend className="font-semibold">Customs declaration</legend>
                        <label className="sm:col-span-2">Contents<Input name="contents" defaultValue={sel.items.map((i) => `${i.quantity} × ${i.name}`).join("; ").slice(0, 200)} required /></label>
                        <label>Declared value (₦)<Input name="declaredValue" inputMode="decimal" defaultValue={minorToInput(physicalValue)} required /></label>
                        <label>HS codes (comma-separated)<Input name="hsCodes" placeholder="e.g. 851712" /></label>
                        <label>Duties<Select name="incoterm"><option value="DAP">Paid by buyer on arrival (DAP)</option><option value="DDP">Paid by me (DDP)</option></Select></label>
                        <div className="flex items-end"><Checkbox name="insured" label="Insure this shipment" /></div>
                        <p className="text-[12px] text-ink-muted sm:col-span-2">Declare the true value. Under-declaring is a customs offence in Nigeria and the destination carrier may hold the parcel. Restricted and prohibited items cannot be shipped.</p>
                      </fieldset>
                    )}
                    <SubmitButton size="sm" confirm="Buy this label? The carrier charges for it and the order will be marked shipped.">Buy label</SubmitButton>
                  </form>
                )}
              </>
            )}
        </section>
      )}
      <h2 className="mb-2 font-semibold">Ready to ship ({toShip.length})</h2>
      {toShip.length === 0 ? <p className="mb-8 text-sm text-ink-muted">Nothing waiting.</p> : (
        <ul className="mb-8 flex flex-wrap gap-2">{toShip.map((o) => <li key={o.id}><Link href={`/vendor/shipments?order=${o.id}`} className={`inline-block rounded-md border px-3 py-1.5 text-[13px] ${sel?.id === o.id ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink"}`}>{o.number} · {(o.order.shippingAddress as { city?: string } | null)?.city ?? ""}</Link></li>)}</ul>
      )}
      <h2 className="mb-2 font-semibold">Shipments</h2>
      <Table>
        <thead><tr><Th>Order</Th><Th>Carrier</Th><Th>Tracking</Th><Th>Route</Th><Th>Status</Th><Th>Label</Th><Th>Updated</Th><Th>Actions</Th></tr></thead>
        <tbody>
          {shipments.length === 0 && <tr><Td colSpan={8} className="py-6 text-center text-ink-muted">No shipments yet.</Td></tr>}
          {shipments.map((s) => (
            <tr key={s.id}>
              <Td><Link href={`/vendor/orders/${s.vendorOrder.id}`} className="hover:text-brand">{s.vendorOrder.number}</Link></Td>
              <Td>{s.carrier}<span className="block text-[11px] text-ink-muted">{shippingProviderName(s.providerKey)}</span></Td>
              <Td className="font-mono text-[12px]">{s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-brand">{s.trackingNumber ?? "track"}</a> : s.trackingNumber ?? "—"}</Td>
              <Td>{s.originCountry ?? vendor.country} → {s.destinationCountry ?? "NG"}</Td>
              <Td>{s.leg !== "DIRECT" && <Badge className="mr-1">{s.leg.toLowerCase().replace(/_/g, " ")}</Badge>}<StatusBadge status={s.status} />{s.pickupScheduledAt && <span className="block text-[11px] text-ink-muted">pickup {s.pickupScheduledAt.toLocaleDateString("en-NG")}</span>}{s.estimatedDeliveryAt && <span className="block text-[11px] text-ink-muted">ETA {s.estimatedDeliveryAt.toLocaleDateString("en-NG")}</span>}{s.failureReason && <span className="block text-[11px] text-danger">{s.failureReason}</span>}</Td>
              <Td>{s.labelUrl ? <a href={s.labelUrl} target="_blank" rel="noopener noreferrer" className="text-brand">Download</a> : s.labels.find((l) => l.url) ? <a href={s.labels.find((l) => l.url)!.url!} target="_blank" rel="noopener noreferrer" className="text-brand">Download</a> : "—"}</Td>
              <Td>{(s.lastEventAt ?? s.updatedAt).toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td>
              <Td className="space-y-1">
                {s.providerKey && s.providerShipmentId && !["DELIVERED", "CANCELLED", "RETURNED"].includes(s.status) && <form action={vendorRefreshTrackingAction}><input type="hidden" name="id" value={s.id} /><SubmitButton size="sm" variant="ghost">Refresh tracking</SubmitButton></form>}
                {["PENDING", "AWAITING_PICKUP"].includes(s.status) && s.leg === "DIRECT" && <>
                  <form action={vendorPickupAction} className="flex gap-1"><input type="hidden" name="id" value={s.id} /><Input name="date" type="date" min={today} required className="h-8 w-36" /><SubmitButton size="sm" variant="ghost">Set pickup</SubmitButton></form>
                  <form action={vendorCancelShipmentAction} className="flex gap-1"><input type="hidden" name="id" value={s.id} /><Input name="reason" placeholder="Cancel reason" required className="h-8 w-36" /><SubmitButton size="sm" variant="ghost" confirm={`Cancel this ${STATUS_LABEL[s.status].toLowerCase()} shipment?`}>Cancel</SubmitButton></form>
                </>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
