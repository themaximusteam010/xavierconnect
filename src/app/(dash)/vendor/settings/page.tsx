import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { addShippingMethodAction, saveStoreSettingsAction, toggleShippingMethodAction } from "@/app/actions/vendor";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";
import { NIGERIAN_STATES } from "@/lib/validation";

export const metadata = { title: "Store settings" };

export default async function Settings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { vendorId } = await requireVendor("settings");
  const sp = await searchParams;
  const [store, methods, staff] = await Promise.all([
    db.store.findUnique({ where: { vendorId } }),
    db.shippingMethod.findMany({ where: { vendorId }, orderBy: { name: "asc" } }),
    db.userRole.findMany({ where: { vendorId }, include: { user: { select: { name: true, email: true } }, role: true } }),
  ]);
  return (
    <>
      <PageHeader title="Settings" />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="max-w-3xl space-y-10">
        {store && (
          <section>
            <h2 className="mb-4 font-semibold">Storefront</h2>
            <form action={saveStoreSettingsAction} className="space-y-4 rounded-lg border border-line bg-white p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Store name" htmlFor="name"><Input id="name" name="name" defaultValue={store.name} required /></Field>
                <Field label="Tagline" htmlFor="tagline"><Input id="tagline" name="tagline" defaultValue={store.tagline ?? ""} /></Field>
              </div>
              <Field label="About" htmlFor="description"><Textarea id="description" name="description" rows={4} defaultValue={store.description ?? ""} /></Field>
              <Field label="Return policy" htmlFor="returnPolicy"><Textarea id="returnPolicy" name="returnPolicy" rows={3} defaultValue={store.returnPolicy ?? ""} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Contact email" htmlFor="contactEmail"><Input id="contactEmail" name="contactEmail" type="email" defaultValue={store.contactEmail ?? ""} /></Field>
                <Field label="Contact phone" htmlFor="contactPhone"><Input id="contactPhone" name="contactPhone" defaultValue={store.contactPhone ?? ""} /></Field>
                <Field label="City" htmlFor="city"><Input id="city" name="city" defaultValue={store.city ?? ""} /></Field>
                <Field label="State" htmlFor="state"><Select id="state" name="state" defaultValue={store.state ?? ""}><option value="">—</option>{NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
                <Field label="Logo" htmlFor="logo" hint="Square image, up to 5 MB."><input id="logo" name="logo" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-sunken file:px-3 file:py-2" /></Field>
                <Field label="Banner" htmlFor="banner" hint="Wide image, at least 1600×400."><input id="banner" name="banner" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-sunken file:px-3 file:py-2" /></Field>
              </div>
              <p className="text-[13px] text-ink-muted">Your store address is /store/{store.slug} and can't be changed after approval.</p>
              <SubmitButton>Save storefront</SubmitButton>
            </form>
          </section>
        )}

        <section>
          <h2 className="mb-4 font-semibold">Delivery options</h2>
          {methods.length > 0 && (
            <Table className="mb-4">
              <thead><tr><Th>Name</Th><Th>Type</Th><Th>Price</Th><Th>Areas</Th><Th>Estimate</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>{methods.map((m) => (
                <tr key={m.id}>
                  <Td className="font-medium text-ink">{m.name}</Td><Td>{m.type.toLowerCase()}</Td>
                  <Td className="tabular">{m.type === "PICKUP" ? "Free" : `${formatMoney(m.rateMinor)}${m.perKgMinor > 0n ? ` + ${formatMoney(m.perKgMinor)}/kg` : ""}`}{m.freeOverMinor ? <span className="block text-[12px] text-ink-muted">Free over {formatMoney(m.freeOverMinor)}</span> : null}</Td>
                  <Td>{m.states.length ? m.states.join(", ") : "Nationwide"}</Td><Td>{m.etaDaysMin}–{m.etaDaysMax} days</Td>
                  <Td><StatusBadge status={m.active ? "ACTIVE" : "ARCHIVED"} /></Td>
                  <Td><form action={toggleShippingMethodAction}><input type="hidden" name="id" value={m.id} /><button className="text-[13px] text-brand">{m.active ? "Disable" : "Enable"}</button></form></Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
          <form action={addShippingMethodAction} className="grid gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-3">
            <Field label="Name" htmlFor="sm-name" className="sm:col-span-2"><Input id="sm-name" name="name" placeholder="e.g. Lagos Island express" required /></Field>
            <Field label="Type" htmlFor="sm-type"><Select id="sm-type" name="type"><option value="FLAT">Flat rate</option><option value="WEIGHT">Weight-based</option><option value="PICKUP">Pickup</option></Select></Field>
            <Field label="Base price (₦)" htmlFor="sm-rate"><Input id="sm-rate" name="rate" inputMode="decimal" defaultValue="0" /></Field>
            <Field label="Per kg (₦)" htmlFor="sm-kg" hint="Weight-based only."><Input id="sm-kg" name="perKg" inputMode="decimal" /></Field>
            <Field label="Free over (₦)" htmlFor="sm-free"><Input id="sm-free" name="freeOver" inputMode="decimal" /></Field>
            <Field label="States (comma-separated)" htmlFor="sm-states" hint="Blank = nationwide." className="sm:col-span-3"><Input id="sm-states" name="states" placeholder="Lagos, Ogun" /></Field>
            <Field label="Min days" htmlFor="sm-min"><Input id="sm-min" name="etaMin" type="number" min={0} defaultValue={1} /></Field>
            <Field label="Max days" htmlFor="sm-max"><Input id="sm-max" name="etaMax" type="number" min={0} defaultValue={5} /></Field>
            <div className="flex items-end"><SubmitButton variant="secondary" className="w-full">Add option</SubmitButton></div>
          </form>
        </section>

        <section>
          <h2 className="mb-1 font-semibold">Team</h2>
          <p className="mb-4 text-sm text-ink-muted">People with access to this store. Staff can manage products and orders but cannot see earnings or withdraw.</p>
          <ul className="divide-y divide-line rounded-lg border border-line bg-white text-sm">{staff.map((s) => <li key={s.id} className="flex justify-between px-4 py-3"><span>{s.user.name} <span className="text-ink-muted">· {s.user.email}</span></span><span className="text-ink-muted">{s.role.name}</span></li>)}</ul>
          <p className="mt-2 text-[12px] text-ink-muted">To add staff, ask them to create an account, then contact support with their email. Self-service invitations are on the roadmap.</p>
        </section>
      </div>
    </>
  );
}
