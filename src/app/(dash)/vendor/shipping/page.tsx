import Link from "next/link";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { SHIPPING_ADAPTERS } from "@/server/integrations/registry";
import { addIntlShippingMethodAction, deletePickupAddressAction, savePickupAddressAction, saveShippingPrefsAction } from "@/app/actions/vendor-finance";
import { toggleShippingMethodAction } from "@/app/actions/vendor";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, FlashFromQuery } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Checkbox, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { countryName, VENDOR_COUNTRIES } from "@/lib/countries";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Shipping" };

export default async function VendorShipping({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; edit?: string }> }) {
  const { vendorId, vendor } = await requireVendor("settings");
  const sp = await searchParams;
  const [pickups, methods, providers] = await Promise.all([
    db.pickupAddress.findMany({ where: { vendorId }, orderBy: { createdAt: "asc" } }),
    db.shippingMethod.findMany({ where: { vendorId }, orderBy: { name: "asc" } }),
    db.integrationProvider.findMany({ where: { kind: "SHIPPING", active: true }, select: { key: true } }),
  ]);
  const edit = pickups.find((p) => p.id === sp.edit);
  const carriers = SHIPPING_ADAPTERS.filter((a) => providers.some((p) => p.key === a.key) && a.routes.some((r) => r.startsWith(`${vendor.country}>`)));
  const intl = methods.filter((m) => m.destinationCountries.length > 0);
  return (
    <>
      <PageHeader title="Shipping" description="Where parcels are collected from, how long you take to dispatch, and how far you deliver." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-3">
          <h2 className="font-semibold">Pickup addresses</h2>
          {pickups.length === 0 && <p className="rounded-lg border border-line bg-white p-4 text-sm text-ink-muted">Add the address carriers collect parcels from. It is also used as the export origin on customs forms.</p>}
          {pickups.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-3 rounded-lg border border-line bg-white p-4 text-sm">
              <div><p className="font-medium">{p.label} {p.isDefault && <Badge tone="brand">default</Badge>}</p><p className="text-ink-muted">{[p.line1, p.line2, p.city, p.region, p.postalCode, countryName(p.country)].filter(Boolean).join(", ")}</p><p className="text-ink-muted">{p.contactName} · {p.phone}</p></div>
              <div className="flex gap-2"><Link href={`/vendor/shipping?edit=${p.id}`} className="text-[13px] text-brand">Edit</Link><form action={deletePickupAddressAction}><input type="hidden" name="id" value={p.id} /><SubmitButton size="sm" variant="ghost" confirm="Remove this address?">Remove</SubmitButton></form></div>
            </div>
          ))}
          <form action={savePickupAddressAction} key={edit?.id ?? "new"} className="grid gap-3 rounded-lg border border-line bg-white p-4 text-[13px] sm:grid-cols-2">
            <p className="font-semibold sm:col-span-2">{edit ? `Edit ${edit.label}` : "Add a pickup address"} <span className="font-normal text-ink-muted">· {countryName(vendor.country)}</span></p>
            {edit && <input type="hidden" name="id" value={edit.id} />}
            <label>Label<Input name="label" defaultValue={edit?.label ?? "Warehouse"} required /></label>
            <label>Contact name<Input name="contactName" defaultValue={edit?.contactName} required /></label>
            <label>Phone (with country code)<Input name="phone" defaultValue={edit?.phone ?? vendor.phone} required /></label>
            <label>Email<Input name="email" type="email" defaultValue={edit?.email ?? vendor.email} required /></label>
            <label className="sm:col-span-2">Street address<Input name="line1" defaultValue={edit?.line1} required /></label>
            <label className="sm:col-span-2">Address line 2<Input name="line2" defaultValue={edit?.line2 ?? ""} /></label>
            <label>City<Input name="city" defaultValue={edit?.city ?? vendor.city ?? ""} required /></label>
            <label>{vendor.country === "NG" ? "State" : "State / province / region"}<Input name="region" defaultValue={edit?.region ?? vendor.state ?? vendor.region ?? ""} required /></label>
            <label>Postal code<Input name="postalCode" defaultValue={edit?.postalCode ?? ""} /></label>
            <div className="flex items-end"><Checkbox name="isDefault" label="Default pickup address" defaultChecked={edit?.isDefault} /></div>
            <div className="sm:col-span-2"><SubmitButton size="sm">Save address</SubmitButton></div>
          </form>
        </section>
        <section className="space-y-6">
          <form action={saveShippingPrefsAction} className="space-y-3 rounded-lg border border-line bg-white p-4 text-[13px]">
            <h2 className="font-semibold">Dispatch</h2>
            <label className="block">Handling time (days from payment to dispatch)<Input name="handlingDays" type="number" min={0} max={30} defaultValue={vendor.handlingDays} className="w-28" /></label>
            <Checkbox name="internationalShipping" label="I ship to buyers outside my country" defaultChecked={vendor.internationalShipping} />
            <SubmitButton size="sm">Save</SubmitButton>
          </form>
          <div className="rounded-lg border border-line bg-white p-4 text-[13px]">
            <h2 className="mb-2 font-semibold">Carriers available from {countryName(vendor.country)}</h2>
            {carriers.length === 0 ? <p className="text-ink-muted">No integrated carrier serves your country yet. Use your own delivery options and enter tracking numbers on each order.</p>
              : <ul className="space-y-1">{carriers.map((c) => <li key={c.key}>{c.name} <span className="text-ink-muted">· {c.routes.filter((r) => r.startsWith(`${vendor.country}>`)).map((r) => r.replace(">", " → ")).join(", ")}</span>{c.status === "SANDBOX_SIMULATOR" && <Badge tone="info" className="ml-1">test mode</Badge>}</li>)}</ul>}
            <p className="mt-2 text-ink-muted">Buy labels from <Link href="/vendor/shipments" className="text-brand underline">Shipments</Link>.</p>
          </div>
          <div className="rounded-lg border border-line bg-white p-4 text-[13px]">
            <h2 className="mb-2 font-semibold">Delivery options shown at checkout</h2>
            <Table>
              <thead><tr><Th>Option</Th><Th>Delivers to</Th><Th className="text-right">Price</Th><Th>Days</Th><Th /></tr></thead>
              <tbody>{methods.length === 0 ? <tr><Td colSpan={5} className="py-4 text-center text-ink-muted">None yet.</Td></tr> : methods.map((m) => (
                <tr key={m.id}><Td>{m.name}{!m.active && <span className="text-ink-muted"> (off)</span>}</Td><Td>{m.destinationCountries.length ? m.destinationCountries.map(countryName).join(", ") : m.states.length ? m.states.join(", ") : `All of ${countryName(vendor.country)}`}</Td><Td className="tabular text-right">{formatMoney(m.rateMinor)}{m.perKgMinor > 0n && ` + ${formatMoney(m.perKgMinor)}/kg`}</Td><Td>{m.etaDaysMin}–{m.etaDaysMax}</Td><Td><form action={toggleShippingMethodAction}><input type="hidden" name="id" value={m.id} /><button className="text-brand">{m.active ? "Disable" : "Enable"}</button></form></Td></tr>
              ))}</tbody>
            </Table>
            <p className="mt-2 text-ink-muted">Add domestic options in <Link href="/vendor/settings" className="text-brand underline">Settings</Link>. {intl.length} international option(s).</p>
          </div>
          <form action={addIntlShippingMethodAction} className="grid gap-3 rounded-lg border border-line bg-white p-4 text-[13px] sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">Add an international delivery option</h2>
            <label className="sm:col-span-2">Name<Input name="name" placeholder="e.g. Air freight to Nigeria" required /></label>
            <label>Base price (₦)<Input name="rate" inputMode="decimal" required /></label>
            <label>Per kg (₦)<Input name="perKg" inputMode="decimal" /></label>
            <label>Min days<Input name="etaMin" type="number" min={0} defaultValue={7} /></label>
            <label>Max days<Input name="etaMax" type="number" min={0} defaultValue={21} /></label>
            <fieldset className="sm:col-span-2"><legend className="mb-1">Delivers to</legend><div className="flex flex-wrap gap-3">{VENDOR_COUNTRIES.filter((c) => c.code !== vendor.country).map((c) => <label key={c.code} className="flex items-center gap-1"><input type="checkbox" name="dest" value={c.code} defaultChecked={c.code === "NG"} /> {c.name}</label>)}</div></fieldset>
            <p className="text-ink-muted sm:col-span-2">Buyers pay in naira. Import duties and taxes are paid by the buyer on arrival unless you ship duties-paid; checkout tells buyers this.</p>
            <div className="sm:col-span-2"><SubmitButton size="sm">Add option</SubmitButton></div>
          </form>
        </section>
      </div>
    </>
  );
}
