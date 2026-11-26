import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { SHIPPING_ADAPTERS } from "@/server/integrations/registry";
import { integrationStatus, STATUS_TONE, CATEGORY_LABEL } from "@/server/services/shipping-admin";
import { saveShippingProviderSettingsAction, saveShippingZoneAction } from "@/app/actions/shipping-ops";
import { ProviderCard } from "@/components/admin/provider-card";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, FlashFromQuery, Alert } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Checkbox, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { getSetting } from "@/server/services/settings";
import { NIGERIAN_STATES } from "@/lib/validation";
import { minorToInput } from "@/lib/money";
import type { Support } from "@/server/integrations/types";

export const metadata = { title: "Shipping providers" };
const SUP: Record<Support, [string, string]> = { YES: ["✓", "text-success"], NO: ["—", "text-ink-muted"], UNVERIFIED: ["?", "text-warning"], VIA_BOOKING: ["at booking", "text-ink-2"], MANUAL: ["manual", "text-ink-2"] };
const TABS: [string, string][] = [["compare", "Provider comparison"], ["providers", "Configuration"], ["zones", "Delivery zones"]];

export default async function ShippingProviders({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; tab?: string; edit?: string }> }) {
  const u = await guard("integrations.view");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "compare";
  const canManage = u.permissions.has("integrations.manage");
  const [rows, stats, zones, strategy] = await Promise.all([
    db.integrationProvider.findMany({ where: { kind: "SHIPPING" } }),
    db.shipment.groupBy({ by: ["providerKey", "status"], _count: true }),
    db.shippingZone.findMany({ orderBy: { name: "asc" } }),
    getSetting(db, "shippingSelection"),
  ]);
  const row = (k: string) => rows.find((r) => r.key === k) ?? null;
  const sorted = [...SHIPPING_ADAPTERS].sort((a, b) => (row(a.key)?.priority ?? 100) - (row(b.key)?.priority ?? 100));
  return (
    <>
      <PageHeader eyebrow="Integrations" title="Shipping providers" description="Carriers, aggregators and freight partners. Each is enabled, configured and tested here — no code changes. Sellers can always deliver themselves at a price they set." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line text-sm">{TABS.map(([k, l]) => <Link key={k} href={`/admin/integrations/shipping?tab=${k}`} className={`-mb-px shrink-0 border-b-2 px-3 py-2 ${tab === k ? "border-ink font-medium" : "border-transparent text-ink-muted hover:text-ink"}`}>{l}</Link>)}</nav>

      {tab === "compare" && (
        <>
          <Alert className="mb-4">Facts below come from each provider&apos;s official website or API documentation (sources on the Configuration tab and in docs/SHIPPING_PROVIDERS.md). “Successfully connected” appears only after a real connection test passes. Checkout courier selection: <span className="font-medium">{String(strategy).toLowerCase()}</span> (change in Platform settings).</Alert>
          <div className="overflow-x-auto">
            <Table>
              <thead><tr><Th>Provider</Th><Th>Category</Th><Th>Coverage</Th><Th>Modes</Th><Th>API</Th>{["Quote", "Book", "Track", "Webhooks", "Labels", "Pickup", "Returns"].map((h) => <Th key={h} className="text-center">{h}</Th>)}<Th>Business account / credentials</Th><Th>Complexity</Th><Th>Status</Th></tr></thead>
              <tbody>
                {sorted.map((a) => {
                  const st = integrationStatus(a, row(a.key));
                  const p = a.profile;
                  return (
                    <tr key={a.key} className="align-top">
                      <Td><span className="font-medium">{a.name}</span>{a.docsUrl && <a href={a.docsUrl} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-brand">docs</a>}</Td>
                      <Td className="text-[12px]">{CATEGORY_LABEL[p.category]}</Td>
                      <Td className="text-[12px]">{p.scope.map((s) => s.toLowerCase()).join(", ")}<span className="block text-ink-muted">{a.routes.length ? a.routes.map((r) => r.replace(">", "→")).join(" ") : p.countries.join(", ")}</span></Td>
                      <Td className="text-[12px]">{p.freightModes.join(", ").toLowerCase()}</Td>
                      <Td className="text-[12px]">{{ PUBLIC: "Public", PARTNER: "Partner (docs public)", PRIVATE: "Private / on request", NONE: "None" }[p.api]}<span className="block text-ink-muted">{p.sandbox}</span></Td>
                      {(["quote", "booking", "tracking", "webhooks", "labels", "pickup", "returns"] as const).map((k) => <Td key={k} className={`text-center text-[12px] ${SUP[p.supports[k]][1]}`}>{SUP[p.supports[k]][0]}</Td>)}
                      <Td className="max-w-56 text-[12px]">{p.businessAccount}<span className="block text-ink-muted">{p.credentialsNote}</span></Td>
                      <Td className="text-[12px]">{p.complexity.toLowerCase()}</Td>
                      <Td><Badge tone={STATUS_TONE[st]}>{st}</Badge>{row(a.key)?.lastCheckAt && <span className="block text-[11px] text-ink-muted">tested {row(a.key)!.lastCheckAt!.toLocaleDateString("en-NG")}</span>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          <p className="mt-2 text-[12px] text-ink-muted">✓ documented by the provider · ? not documented / unconfirmed · manual = handled by staff outside an API · “at booking” = pickup is chosen when the shipment is booked.</p>
        </>
      )}

      {tab === "providers" && (
        <div className="space-y-6">
          {sorted.map((a) => {
            const r = row(a.key);
            const s = stats.filter((x) => x.providerKey === a.key);
            const st = integrationStatus(a, r);
            const extra = (
              <div className="space-y-2">
                <p><Badge tone={STATUS_TONE[st]}>{st}</Badge>{r?.lastCheckMessage && <span className="ml-2 text-ink-muted">{r.lastCheckMessage}</span>}</p>
                {s.length > 0 && <p><span className="text-ink-muted">Shipments: </span>{s.map((x) => `${x._count} ${x.status.toLowerCase().replace(/_/g, " ")}`).join(" · ")}</p>}
                {a.checkoutRates === false && <p className="text-warning">Not offered at checkout: provider terms forbid storing or marking up its rates.</p>}
                <details><summary className="cursor-pointer text-brand">What&apos;s needed to enable it</summary><ol className="mt-1 list-decimal pl-5">{a.profile.remaining.map((x) => <li key={x}>{x}</li>)}</ol><p className="mt-1">{a.profile.sources.map((x) => <a key={x.url} href={x.url} target="_blank" rel="noopener noreferrer" className="mr-3 text-brand underline">{x.label}</a>)}</p></details>
              </div>
            );
            return (
              <div key={a.key} className="space-y-2">
                <ProviderCard adapter={a} row={r} back="/admin/integrations/shipping?tab=providers" canManage={canManage} extra={extra} />
                {canManage && r && (
                  <form action={saveShippingProviderSettingsAction} className="grid gap-3 rounded-lg border border-dashed border-line-strong bg-white p-4 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
                    <input type="hidden" name="key" value={a.key} />
                    <p className="font-medium sm:col-span-3 lg:col-span-6">{a.name} · shipping settings</p>
                    <label>Priority (1 = first)<Input name="priority" type="number" min={1} max={999} defaultValue={r.priority} /></label>
                    <label>Min weight (kg)<Input name="minKg" inputMode="decimal" defaultValue={r.minWeightGrams != null ? r.minWeightGrams / 1000 : ""} /></label>
                    <label>Max weight (kg)<Input name="maxKg" inputMode="decimal" defaultValue={r.maxWeightGrams != null ? r.maxWeightGrams / 1000 : ""} /></label>
                    <label>Markup %<Input name="markupPct" inputMode="decimal" defaultValue={r.feeBps ? r.feeBps / 100 : ""} /></label>
                    <label>Fixed fee (₦)<Input name="markupFixed" inputMode="decimal" defaultValue={r.feeFixedMinor ? minorToInput(r.feeFixedMinor) : ""} /></label>
                    <div className="flex items-end"><Checkbox name="isDefault" label="Default provider" defaultChecked={r.isDefault} /></div>
                    <fieldset className="sm:col-span-3 lg:col-span-6"><legend className="mb-1">Delivery zones (none ticked = all states)</legend><div className="flex flex-wrap gap-3">{zones.length === 0 ? <span className="text-ink-muted">No zones yet — add them on the Delivery zones tab.</span> : zones.map((z) => <label key={z.id} className="flex items-center gap-1"><input type="checkbox" name="zones" value={z.id} defaultChecked={r.zones.includes(z.id)} /> {z.name}</label>)}</div></fieldset>
                    <div className="sm:col-span-3 lg:col-span-6"><SubmitButton size="sm" variant="secondary">Save shipping settings</SubmitButton></div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "zones" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <Table>
            <thead><tr><Th>Zone</Th><Th>States</Th><Th>Providers using it</Th><Th /></tr></thead>
            <tbody>
              {zones.length === 0 && <tr><Td colSpan={4} className="py-6 text-center text-ink-muted">No zones. Without zones, active providers are offered for every state their API serves.</Td></tr>}
              {zones.map((z) => <tr key={z.id}><Td className="font-medium">{z.name}{!z.active && <Badge className="ml-1">off</Badge>}</Td><Td className="text-[12px]">{z.regions.join(", ")}</Td><Td className="text-[12px]">{rows.filter((r) => r.zones.includes(z.id)).map((r) => r.name).join(", ") || "—"}</Td><Td><Link href={`/admin/integrations/shipping?tab=zones&edit=${z.id}`} className="text-[12px] text-brand">Edit</Link></Td></tr>)}
            </tbody>
          </Table>
          {canManage && (() => {
            const e = zones.find((z) => z.id === sp.edit);
            return (
              <form action={saveShippingZoneAction} key={e?.id ?? "new"} className="h-fit space-y-3 rounded-lg border border-line bg-white p-4 text-[13px]">
                <p className="font-semibold">{e ? `Edit ${e.name}` : "New zone"}</p>
                {e && <input type="hidden" name="id" value={e.id} />}
                <label className="block">Name<Input name="name" defaultValue={e?.name} required placeholder="e.g. Lagos & Ogun" /></label>
                <fieldset><legend className="mb-1">States</legend><div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto">{NIGERIAN_STATES.map((s) => <label key={s} className="flex items-center gap-1"><input type="checkbox" name="regions" value={s} defaultChecked={e?.regions.includes(s)} /> {s}</label>)}</div></fieldset>
                {e && <Checkbox name="active" label="Active" defaultChecked={e.active} />}
                <SubmitButton size="sm">Save zone</SubmitButton>
              </form>
            );
          })()}
        </div>
      )}
    </>
  );
}
