import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Clock, MapPin, CalendarX } from "lucide-react";
import { db } from "@/server/db";
import { availableSlots } from "@/server/services/bookings";
import { bookServiceAction } from "@/app/actions/booking";
import { Alert } from "@/components/ui/feedback";
import { Input, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { VerifiedMark } from "@/components/commerce/verified";
import { Stars } from "@/components/commerce/stars";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

async function load(slug: string) {
  return db.service.findFirst({ where: { slug, status: "PUBLISHED", deletedAt: null, vendor: { status: "APPROVED" } }, include: { packages: { orderBy: { priceMinor: "asc" } }, availability: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] }, category: true, vendor: { include: { store: true } }, reviews: { where: { status: "PUBLISHED" }, take: 10, orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } } } });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const s = await load((await params).slug);
  return s ? { title: s.title, description: s.summary ?? undefined, alternates: { canonical: `/services/${s.slug}` } } : { title: "Service not found" };
}

export default async function ServicePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ package?: string; date?: string; error?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await load(slug);
  if (!s) notFound();
  const pkg = s.packages.find((p) => p.id === sp.package) ?? s.packages[0];
  const todayLagos = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
  const maxDate = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date >= todayLagos && sp.date <= maxDate ? sp.date : null;
  const slots = pkg && date ? await availableSlots(s.id, pkg.id, date) : [];
  const store = s.vendor.store!;

  return (
    <div className="container-x py-8">
      <nav aria-label="Breadcrumb" className="mb-6 text-[13px] text-ink-muted"><Link href="/services" className="hover:text-ink">Services</Link><span className="mx-1">/</span><Link href={`/services?category=${s.category.slug}`} className="hover:text-ink">{s.category.name}</Link></nav>
      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <h1 className="text-2xl font-semibold leading-tight sm:text-[28px]">{s.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted">
            <Link href={`/store/${store.slug}`} className="flex items-center gap-1 text-ink-2 hover:text-brand">{store.name}<VerifiedMark level={s.vendor.verificationLevel} /></Link>
            <span className="flex items-center gap-1"><MapPin className="size-3" />{s.location === "REMOTE" ? "Remote" : s.location === "BOTH" ? `Remote or on-site in ${s.state}` : [s.city, s.state].filter(Boolean).join(", ")}</span>
            <Stars value={s.ratingAvg} count={s.ratingCount} size={12} />
          </div>
          <div className="prose-xc mt-6 whitespace-pre-line">{s.description}</div>

          <h2 className="mb-3 mt-10 text-lg font-semibold">Packages</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {s.packages.map((p) => (
              <Link key={p.id} href={`/services/${s.slug}?package=${p.id}${date ? `&date=${date}` : ""}`} scroll={false} className={cn("rounded-lg border p-4", pkg?.id === p.id ? "border-ink ring-1 ring-ink" : "border-line hover:border-line-strong")}>
                <p className="eyebrow">{p.tier.toLowerCase()}</p>
                <p className="tabular mt-1 text-lg font-semibold">{formatMoney(p.priceMinor)}</p>
                <p className="mt-1 text-[13px] leading-5 text-ink-2">{p.description}</p>
                <p className="mt-3 flex items-center gap-1 text-[12px] text-ink-muted"><Clock className="size-3" />{p.durationMinutes >= 60 ? `${p.durationMinutes / 60} hr` : `${p.durationMinutes} min`} session{p.deliveryDays ? ` · delivery in ${p.deliveryDays} days` : ""}</p>
              </Link>
            ))}
          </div>

          <h2 className="mb-3 mt-10 text-lg font-semibold">Opening hours</h2>
          <dl className="grid max-w-sm grid-cols-[60px_1fr] gap-y-1 text-sm">
            {DAYS.map((d, i) => { const h = s.availability.filter((a) => a.weekday === i); return [<dt key={`d${i}`} className="text-ink-muted">{d}</dt>, <dd key={`h${i}`} className="tabular">{h.length ? h.map((x) => `${hhmm(x.startMinute)}–${hhmm(x.endMinute)}`).join(", ") : "Closed"}</dd>]; })}
          </dl>
          {s.cancellationPolicy && <><h2 className="mb-2 mt-10 text-lg font-semibold">Cancellation policy</h2><p className="text-sm text-ink-2">{s.cancellationPolicy}</p></>}
        </div>

        <aside className="h-fit rounded-lg border border-line p-5 lg:sticky lg:top-6">
          <h2 className="font-semibold">Book {pkg?.name.split("—")[0].trim()}</h2>
          {sp.error && <Alert tone="danger" className="mt-3">{sp.error}</Alert>}
          <form action={`/services/${s.slug}`} className="mt-4 flex items-end gap-2">
            <input type="hidden" name="package" value={pkg?.id} />
            <label className="flex-1 text-[13px] font-medium text-ink-2">Date<Input type="date" name="date" min={todayLagos} max={maxDate} defaultValue={date ?? ""} required className="mt-1.5" /></label>
            <Button type="submit" variant="secondary">See times</Button>
          </form>
          {date && (slots.length === 0 ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-muted"><CalendarX className="size-4" />No free times on this day. Try another date.</p>
          ) : (
            <form action={bookServiceAction} className="mt-5 space-y-4">
              <input type="hidden" name="serviceId" value={s.id} /><input type="hidden" name="slug" value={s.slug} /><input type="hidden" name="packageId" value={pkg!.id} /><input type="hidden" name="date" value={date} />
              <fieldset>
                <legend className="mb-2 text-[13px] font-medium text-ink-2">Start time (Lagos)</legend>
                <div className="grid grid-cols-4 gap-2">
                  {slots.map((sl, i) => (
                    <label key={sl.minute} className="cursor-pointer">
                      <input type="radio" name="minute" value={sl.minute} defaultChecked={i === 0} className="peer sr-only" />
                      <span className="tabular flex h-9 items-center justify-center rounded-md border border-line-strong text-sm peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-brand">{sl.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {s.location !== "REMOTE" && <label className="block text-[13px] font-medium text-ink-2">Address for the appointment<Input name="address" className="mt-1.5" placeholder="Where should the provider come?" /></label>}
              <label className="block text-[13px] font-medium text-ink-2">Notes for the provider<Textarea name="notes" rows={3} className="mt-1.5" /></label>
              <div className="tabular flex justify-between border-t border-line pt-4 text-sm font-semibold"><span>Total</span><span>{formatMoney(pkg!.priceMinor)}</span></div>
              <SubmitButton className="w-full" size="lg" pendingLabel="Holding your slot…">Book and pay</SubmitButton>
              <p className="text-center text-[12px] text-ink-muted">The provider is paid after the service is completed.</p>
            </form>
          ))}
        </aside>
      </div>
    </div>
  );
}
