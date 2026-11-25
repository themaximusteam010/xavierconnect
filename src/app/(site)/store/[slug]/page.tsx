import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MapPin, Mail, Phone } from "lucide-react";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { productCardInclude, publicProductWhere } from "@/server/services/catalog";
import { toggleFollowStore } from "@/app/actions/public";
import { ProductGrid } from "@/components/commerce/product-card";
import { VerifiedMark } from "@/components/commerce/verified";
import { Stars } from "@/components/commerce/stars";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { formatMoney } from "@/lib/money";

async function load(slug: string) {
  return db.store.findFirst({ where: { slug, vendor: { status: "APPROVED" } }, include: { vendor: { include: { shippingMethods: { where: { active: true } } } }, _count: { select: { followers: true } } } });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const s = await load((await params).slug);
  return s ? { title: s.name, description: s.tagline ?? s.description ?? undefined, alternates: { canonical: `/store/${s.slug}` } } : { title: "Store not found" };
}

export default async function StorePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string; tab?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const store = await load(slug);
  if (!store) notFound();
  const user = await getCurrentUser();
  const page = Math.max(1, Number(sp.page) || 1);
  const where = { AND: [publicProductWhere(), { vendorId: store.vendorId }] };
  const [products, total, services, following] = await Promise.all([
    db.product.findMany({ where, orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }], skip: (page - 1) * 24, take: 24, include: productCardInclude }),
    db.product.count({ where }),
    db.service.findMany({ where: { vendorId: store.vendorId, status: "PUBLISHED", deletedAt: null }, include: { packages: { orderBy: { priceMinor: "asc" }, take: 1 } } }),
    user ? db.storeFollow.findUnique({ where: { userId_storeId: { userId: user.id, storeId: store.id } } }) : null,
  ]);
  await db.analyticsEvent.create({ data: { type: "STORE_VISIT", vendorId: store.vendorId } });
  const tab = sp.tab === "about" ? "about" : sp.tab === "services" && services.length ? "services" : "products";

  return (
    <div>
      <div className="h-32 bg-canvas sm:h-44" style={store.bannerUrl ? { backgroundImage: `url(${store.bannerUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined} />
      <div className="container-x">
        <div className="-mt-10 flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <span className="flex size-20 items-center justify-center overflow-hidden rounded-lg border-4 border-white bg-sunken text-xl font-semibold text-ink-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {store.logoUrl ? <img src={store.logoUrl} alt={`${store.name} logo`} className="size-full object-cover" /> : store.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="pb-1">
              <h1 className="flex items-center gap-1.5 text-xl font-semibold sm:text-2xl">{store.name}<VerifiedMark level={store.vendor.verificationLevel} /></h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[13px] text-ink-muted">
                {store.tagline && <span>{store.tagline}</span>}
                {(store.city || store.state) && <span className="flex items-center gap-1"><MapPin className="size-3" />{[store.city, store.state].filter(Boolean).join(", ")}</span>}
                <Stars value={store.ratingAvg} count={store.ratingCount} size={12} />
                <span>{store._count.followers} followers</span>
              </p>
            </div>
          </div>
          <form action={toggleFollowStore}>
            <input type="hidden" name="storeId" value={store.id} /><input type="hidden" name="back" value={`/store/${store.slug}`} />
            <Button type="submit" variant={following ? "secondary" : "primary"} size="sm">{following ? "Following" : "Follow store"}</Button>
          </form>
        </div>
        <nav className="flex gap-6 border-b border-line text-sm" aria-label="Store sections">
          {[["products", `Products (${total})`], ...(services.length ? [["services", `Services (${services.length})`]] : []), ["about", "About & policies"]].map(([k, label]) => (
            <Link key={k} href={`/store/${store.slug}?tab=${k}`} className={`-mb-px border-b-2 py-3 ${tab === k ? "border-ink font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>{label}</Link>
          ))}
        </nav>
        <div className="py-8">
          {tab === "products" && (products.length ? <><ProductGrid products={products} /><Pagination page={page} pages={Math.ceil(total / 24)} href={(p) => `/store/${store.slug}?page=${p}`} /></> : <EmptyState title="No products listed yet" />)}
          {tab === "services" && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {services.map((s) => <li key={s.id}><Link href={`/services/${s.slug}`} className="flex items-center justify-between gap-4 p-4 hover:bg-canvas"><span><span className="font-medium">{s.title}</span><span className="block text-[13px] text-ink-muted">{s.summary}</span></span>{s.packages[0] && <span className="tabular shrink-0 text-sm">From {formatMoney(s.packages[0].priceMinor)}</span>}</Link></li>)}
            </ul>
          )}
          {tab === "about" && (
            <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
              <div className="prose-xc whitespace-pre-line">{store.description ?? "This store hasn't added a description yet."}
                {store.returnPolicy && <><h2>Returns</h2><p>{store.returnPolicy}</p></>}
              </div>
              <aside className="space-y-4 text-sm">
                {store.vendor.shippingMethods.length > 0 && (
                  <div className="rounded-lg border border-line p-4"><p className="eyebrow mb-2">Delivery options</p>
                    <ul className="space-y-1.5">{store.vendor.shippingMethods.map((m) => <li key={m.id} className="flex justify-between gap-3"><span>{m.name}</span><span className="tabular text-ink-muted">{m.rateMinor === 0n ? "Free" : `from ${formatMoney(m.rateMinor)}`}</span></li>)}</ul>
                  </div>
                )}
                {(store.contactEmail || store.contactPhone) && (
                  <div className="rounded-lg border border-line p-4 space-y-1.5"><p className="eyebrow mb-2">Contact</p>
                    {store.contactEmail && <p className="flex items-center gap-2"><Mail className="size-4 text-ink-muted" />{store.contactEmail}</p>}
                    {store.contactPhone && <p className="flex items-center gap-2"><Phone className="size-4 text-ink-muted" />{store.contactPhone}</p>}
                  </div>
                )}
                <p className="text-[12px] text-ink-muted">Selling on XavierConnect since {store.createdAt.toLocaleDateString("en-NG", { month: "long", year: "numeric" })}.</p>
              </aside>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
