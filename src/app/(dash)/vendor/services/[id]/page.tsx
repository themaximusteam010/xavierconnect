import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { saveServiceAction } from "@/app/actions/vendor";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { minorToInput } from "@/lib/money";
import { NIGERIAN_STATES } from "@/lib/validation";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function EditService({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { vendorId, vendor } = await requireVendor("services");
  const { id } = await params;
  const sp = await searchParams;
  const s = id === "new" ? null : await db.service.findFirst({ where: { id, vendorId, deletedAt: null }, include: { packages: true, availability: true } });
  if (id !== "new" && !s) notFound();
  const cats = await db.category.findMany({ where: { kind: "SERVICE", parentId: { not: null } }, orderBy: { sortOrder: "asc" } });
  const pkg = (t: string) => s?.packages.find((p) => p.tier === t);
  return (
    <>
      <PageHeader title={s ? s.title : "New service"} description={s ? <StatusBadge status={s.status} /> : undefined} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <form action={saveServiceAction} className="max-w-3xl space-y-6">
        <input type="hidden" name="id" value={s?.id ?? ""} />
        <section className="space-y-4 rounded-lg border border-line bg-white p-5">
          <Field label="Title" htmlFor="title" required><Input id="title" name="title" defaultValue={s?.title} required /></Field>
          <Field label="Category" htmlFor="categoryId" required><Select id="categoryId" name="categoryId" defaultValue={s?.categoryId ?? ""}><option value="">Choose</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Summary" htmlFor="summary" hint="One line shown in search results."><Input id="summary" name="summary" defaultValue={s?.summary ?? ""} maxLength={200} /></Field>
          <Field label="Description" htmlFor="description" required><Textarea id="description" name="description" rows={6} defaultValue={s?.description} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Where" htmlFor="location"><Select id="location" name="location" defaultValue={s?.location ?? "ONSITE"}><option value="ONSITE">At the customer's location</option><option value="REMOTE">Remote / online</option><option value="BOTH">Either</option></Select></Field>
            <Field label="City" htmlFor="city"><Input id="city" name="city" defaultValue={s?.city ?? vendor.city ?? ""} /></Field>
            <Field label="State" htmlFor="state"><Select id="state" name="state" defaultValue={s?.state ?? vendor.state ?? ""}><option value="">—</option>{NIGERIAN_STATES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
          </div>
          <Field label="Cancellation policy" htmlFor="cancellationPolicy"><Input id="cancellationPolicy" name="cancellationPolicy" defaultValue={s?.cancellationPolicy ?? "Free cancellation up to 24 hours before the appointment."} /></Field>
        </section>
        <section className="rounded-lg border border-line bg-white p-5">
          <h2 className="font-semibold">Packages</h2>
          <p className="mb-4 text-[13px] text-ink-muted">Fill in one to three. Leave a package's name empty to skip it.</p>
          <div className="grid gap-4 lg:grid-cols-3">
            {(["BASIC", "STANDARD", "PREMIUM"] as const).map((t) => (
              <fieldset key={t} className="space-y-3 rounded-md border border-line p-3">
                <legend className="eyebrow px-1">{t.toLowerCase()}</legend>
                <Input name={`${t}_name`} placeholder="Package name" defaultValue={pkg(t)?.name} aria-label={`${t} name`} />
                <Textarea name={`${t}_desc`} rows={2} placeholder="What's included" defaultValue={pkg(t)?.description} aria-label={`${t} description`} />
                <Input name={`${t}_price`} inputMode="decimal" placeholder="Price (₦)" defaultValue={minorToInput(pkg(t)?.priceMinor)} aria-label={`${t} price`} />
                <div className="grid grid-cols-2 gap-2">
                  <Input name={`${t}_mins`} type="number" min={15} step={15} placeholder="Minutes" defaultValue={pkg(t)?.durationMinutes ?? 60} aria-label={`${t} session minutes`} />
                  <Input name={`${t}_days`} type="number" min={0} placeholder="Delivery days" defaultValue={pkg(t)?.deliveryDays ?? ""} aria-label={`${t} delivery days`} />
                </div>
              </fieldset>
            ))}
          </div>
        </section>
        <section className="rounded-lg border border-line bg-white p-5">
          <h2 className="mb-4 font-semibold">Weekly hours (Lagos time)</h2>
          <div className="space-y-2">
            {DAYS.map((d, i) => { const a = s?.availability.find((x) => x.weekday === i); const on = s ? !!a : i >= 1 && i <= 5; return (
              <div key={d} className="flex items-center gap-3 text-sm">
                <label className="flex w-32 items-center gap-2"><input type="checkbox" name={`day_${i}`} defaultChecked={on} className="size-4 accent-[var(--color-brand)]" />{d}</label>
                <Input type="time" name={`start_${i}`} defaultValue={a ? hhmm(a.startMinute) : "09:00"} className="h-9 w-32" aria-label={`${d} opens`} />
                <span className="text-ink-muted">to</span>
                <Input type="time" name={`end_${i}`} defaultValue={a ? hhmm(a.endMinute) : "17:00"} className="h-9 w-32" aria-label={`${d} closes`} />
              </div>
            ); })}
          </div>
        </section>
        <div className="flex gap-2">
          {vendor.status === "APPROVED" && (!s || ["DRAFT", "REJECTED"].includes(s.status)) && <SubmitButton name="intent" value="submit">Save and submit for review</SubmitButton>}
          <SubmitButton name="intent" value="draft" variant="secondary">Save</SubmitButton>
        </div>
      </form>
    </>
  );
}
