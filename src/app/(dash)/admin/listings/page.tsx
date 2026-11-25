import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { moderateListingAction, resolveReportAction, toggleFeaturedAction } from "@/app/actions/admin";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Listings" };

export default async function Listings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; fq?: string }> }) {
  const u = await guard("listing.moderate");
  const sp = await searchParams;
  const [products, services, reports, featured] = await Promise.all([
    db.product.findMany({ where: { status: "PENDING_REVIEW", deletedAt: null }, orderBy: { updatedAt: "asc" }, take: 50, include: { images: { take: 3, orderBy: { sortOrder: "asc" } }, category: true, vendor: { include: { store: true } } } }),
    db.service.findMany({ where: { status: "PENDING_REVIEW" }, orderBy: { updatedAt: "asc" }, take: 50, include: { packages: true, category: true, vendor: { include: { store: true } } } }),
    db.report.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 50, include: { reporter: { select: { name: true } } } }),
    db.product.findMany({ where: { isFeatured: true, status: "PUBLISHED" }, take: 20, select: { id: true, name: true, slug: true } }),
  ]);
  const found = sp.fq ? await db.product.findMany({ where: { status: "PUBLISHED", isFeatured: false, name: { contains: sp.fq, mode: "insensitive" } }, take: 8, select: { id: true, name: true } }) : [];
  const reportTargets = await db.product.findMany({ where: { id: { in: reports.filter((r) => r.targetType === "PRODUCT").map((r) => r.targetId) } }, select: { id: true, name: true, slug: true } });
  const Decide = ({ id, kind }: { id: string; kind: "product" | "service" }) => (
    <form action={moderateListingAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="kind" value={kind} />
      <SubmitButton name="decision" value="approve" size="sm">Approve</SubmitButton>
      <Input name="reason" placeholder="Reason if rejecting" className="h-8 w-56" />
      <SubmitButton name="decision" value="reject" size="sm" variant="secondary">Reject</SubmitButton>
    </form>
  );
  return (
    <>
      <PageHeader title="Listings" description="Review new and edited listings before they go live." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <section className="mb-10">
        <h2 className="mb-3 font-semibold">Products awaiting review ({products.length})</h2>
        {products.length === 0 ? <p className="text-sm text-ink-muted">Queue is empty.</p> : (
          <ul className="space-y-3">
            {products.map((p) => (
              <li key={p.id} className="rounded-lg border border-line bg-white p-4">
                <div className="flex flex-wrap gap-4">
                  <div className="flex gap-2">{p.images.map((im) => /* eslint-disable-next-line @next/next/no-img-element */ <img key={im.id} src={im.url} alt="" className="size-20 rounded border border-line object-cover" />)}</div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-ink-muted">{p.vendor.store?.name} · {p.category.name} · {p.type.toLowerCase()} · <span className="tabular">{formatMoney(p.salePriceMinor ?? p.priceMinor)}</span></p>
                    <p className="mt-2 line-clamp-3 text-ink-2">{p.description}</p>
                  </div>
                </div>
                <div className="mt-3 border-t border-line pt-3"><Decide id={p.id} kind="product" /></div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mb-10">
        <h2 className="mb-3 font-semibold">Services awaiting review ({services.length})</h2>
        {services.length === 0 ? <p className="text-sm text-ink-muted">Queue is empty.</p> : (
          <ul className="space-y-3">{services.map((s) => (
            <li key={s.id} className="rounded-lg border border-line bg-white p-4 text-sm">
              <p className="font-medium">{s.title}</p><p className="text-ink-muted">{s.vendor.store?.name} · {s.category.name} · {s.packages.map((p) => formatMoney(p.priceMinor)).join(" / ")}</p>
              <p className="mt-2 line-clamp-3 text-ink-2">{s.description}</p>
              <div className="mt-3 border-t border-line pt-3"><Decide id={s.id} kind="service" /></div>
            </li>
          ))}</ul>
        )}
      </section>
      <section className="mb-10">
        <h2 className="mb-3 font-semibold">Reports from users ({reports.length})</h2>
        {reports.length === 0 ? <p className="text-sm text-ink-muted">No open reports.</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-white text-sm">{reports.map((r) => { const t = reportTargets.find((x) => x.id === r.targetId); return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span><b>{r.reason}</b> · {r.targetType.toLowerCase()} {t ? <Link href={`/p/${t.slug}`} className="text-brand underline">{t.name}</Link> : r.targetId} · by {r.reporter.name}{r.details && <span className="block text-ink-muted">“{r.details}”</span>}</span>
              <form action={resolveReportAction} className="flex gap-2"><input type="hidden" name="id" value={r.id} /><SubmitButton name="status" value="ACTIONED" size="sm" variant="secondary">Actioned</SubmitButton><SubmitButton name="status" value="DISMISSED" size="sm" variant="ghost">Dismiss</SubmitButton></form>
            </li>
          ); })}</ul>
        )}
      </section>
      {u.permissions.has("cms.manage") && (
        <section>
          <h2 className="mb-1 font-semibold">Featured products</h2>
          <p className="mb-3 text-sm text-ink-muted">Shown in the homepage “Featured” rail.</p>
          <ul className="flex flex-wrap gap-2">{featured.map((p) => <li key={p.id}><form action={toggleFeaturedAction} className="flex items-center gap-2 rounded-full border border-line bg-white py-1 pl-3 pr-1 text-sm"><Link href={`/p/${p.slug}`}>{p.name}</Link><input type="hidden" name="id" value={p.id} /><input type="hidden" name="kind" value="product" /><button className="rounded-full px-2 text-ink-muted hover:bg-sunken" aria-label={`Unfeature ${p.name}`}>×</button></form></li>)}</ul>
          <form className="mt-4 flex gap-2"><Input name="fq" defaultValue={sp.fq} placeholder="Find a live product to feature" className="h-9 max-w-xs" /><SubmitButton size="sm" variant="secondary" className="h-9">Search</SubmitButton></form>
          {found.length > 0 && <ul className="mt-3 space-y-1 text-sm">{found.map((p) => <li key={p.id}><form action={toggleFeaturedAction} className="flex items-center gap-3"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="kind" value="product" /><span>{p.name}</span><button className="text-brand">Feature</button></form></li>)}</ul>}
        </section>
      )}
    </>
  );
}
