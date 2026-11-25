import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { db } from "@/server/db";
import { productRail, marketplaceFacts, type RailSource } from "@/server/services/home";
import { ProductGrid } from "@/components/commerce/product-card";
import { ButtonLink } from "@/components/ui/button";
import { SearchBox } from "@/components/layout/search-box";
import { VerifiedMark } from "@/components/commerce/verified";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { HomepageSection } from "@prisma/client";

type Cfg = { source?: RailSource; limit?: number; ctaLabel?: string; ctaHref?: string; placement?: string };
const cfg = (s: HomepageSection) => (s.config ?? {}) as Cfg;

function SectionHead({ title, subtitle, href, label = "View all" }: { title: string; subtitle?: string | null; href?: string; label?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {href && <Link href={href} className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand hover:underline">{label}<ArrowRight className="size-3.5" /></Link>}
    </div>
  );
}

export async function Hero({ s }: { s: HomepageSection }) {
  const facts = await marketplaceFacts();
  return (
    <section className="border-b border-line bg-canvas">
      <div className="container-x grid items-center gap-10 py-12 lg:grid-cols-[1.25fr_1fr] lg:py-16">
        <div>
          <p className="eyebrow mb-4">XavierConnect by Xavier Enterprise</p>
          <h1 className="max-w-xl text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">{s.title ?? "Discover products. Find services. Grow businesses."}</h1>
          <p className="mt-4 max-w-lg text-[16px] leading-7 text-ink-2">{s.subtitle ?? "One marketplace for goods, professional services and digital products from independent sellers across Nigeria."}</p>
          <SearchBox className="mt-7 max-w-lg" />
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href="/shop" size="lg">Shop now</ButtonLink>
            <ButtonLink href="/services" size="lg" variant="secondary">Explore services</ButtonLink>
          </div>
        </div>
        <div className="rounded-lg bg-brand p-7 text-white sm:p-9">
          <p className="text-sm text-blue-100">On XavierConnect today</p>
          <dl className="mt-5 grid grid-cols-3 gap-4 border-b border-white/20 pb-6">
            {[["Products", facts.products], ["Services", facts.services], ["Stores", facts.stores]].map(([k, v]) => (
              <div key={k as string}><dt className="text-[12px] text-blue-100">{k}</dt><dd className="tabular mt-1 text-2xl font-semibold">{(v as number).toLocaleString("en-NG")}</dd></div>
            ))}
          </dl>
          <ul className="mt-6 space-y-3 text-[14px] leading-6 text-blue-50">
            <li><span className="font-semibold text-white">One checkout, many sellers.</span> Each seller ships and is paid for their part of your order.</li>
            <li><span className="font-semibold text-white">Sellers are paid after delivery.</span> We release a seller&apos;s earnings only after delivery and a short review period, and pause them if you report a problem.</li>
            <li><span className="font-semibold text-white">Verified sellers are marked.</span> We only show a badge after we check documents.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

export async function CategoryGrid({ s }: { s: HomepageSection }) {
  const cats = await db.category.findMany({
    where: { parentId: null },
    orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }],
    take: cfg(s).limit ?? 12,
    include: {
      _count: { select: { products: { where: { status: "PUBLISHED", deletedAt: null } }, services: { where: { status: "PUBLISHED" } } } },
      children: { select: { _count: { select: { products: { where: { status: "PUBLISHED", deletedAt: null } }, services: { where: { status: "PUBLISHED" } } } } } },
    },
  });
  if (!cats.length) return null;
  return (
    <section className="container-x py-12">
      <SectionHead title={s.title ?? "Shop by category"} subtitle={s.subtitle} />
      <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {cats.map((c) => {
          const k = c.kind === "SERVICE" ? "services" : "products";
          const n = c._count[k] + c.children.reduce((a, ch) => a + ch._count[k], 0);
          const href = c.kind === "SERVICE" ? `/services?category=${c.slug}` : `/shop?category=${c.slug}`;
          return (
            <li key={c.id} className="bg-white">
              <Link href={href} className="flex h-full flex-col justify-between gap-6 p-4 hover:bg-canvas">
                <span className="text-[14px] font-medium leading-snug text-ink">{c.name}</span>
                <span className="tabular text-[12px] text-ink-muted">{n} {c.kind === "SERVICE" ? (n === 1 ? "service" : "services") : n === 1 ? "listing" : "listings"}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export async function ProductRail({ s }: { s: HomepageSection }) {
  const c = cfg(s);
  const items = await productRail(c.source ?? "new", c.limit ?? 10);
  if (!items.length) return null;
  const href = c.ctaHref ?? (c.source === "deals" ? "/deals" : c.source === "digital" ? "/shop?type=digital" : c.source === "bestsellers" ? "/shop?sort=popular" : "/shop?sort=newest");
  return (
    <section className="container-x py-10">
      <SectionHead title={s.title ?? "New arrivals"} subtitle={s.subtitle} href={href} />
      <ProductGrid products={items} cols={5} />
    </section>
  );
}

export async function ServiceRail({ s }: { s: HomepageSection }) {
  const items = await db.service.findMany({
    where: { status: "PUBLISHED", deletedAt: null, vendor: { status: "APPROVED" } },
    orderBy: [{ isFeatured: "desc" }, { ratingAvg: "desc" }, { createdAt: "desc" }],
    take: cfg(s).limit ?? 6,
    include: { packages: { orderBy: { priceMinor: "asc" }, take: 1 }, category: true, vendor: { include: { store: true } } },
  });
  if (!items.length) return null;
  return (
    <section className="container-x py-10">
      <SectionHead title={s.title ?? "Popular services"} subtitle={s.subtitle} href="/services" />
      <ul className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {items.map((sv) => (
          <li key={sv.id} className="bg-white">
            <Link href={`/services/${sv.slug}`} className="flex h-full flex-col gap-2 p-5 hover:bg-canvas">
              <span className="eyebrow">{sv.category.name}</span>
              <span className="font-medium leading-snug text-ink">{sv.title}</span>
              <span className="text-[13px] text-ink-muted">{sv.vendor.store?.name} · {sv.location === "REMOTE" ? "Remote" : [sv.city, sv.state].filter(Boolean).join(", ")}</span>
              {sv.packages[0] && <span className="tabular mt-auto pt-2 text-sm text-ink">From <span className="font-semibold">{formatMoney(sv.packages[0].priceMinor)}</span></span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export async function VendorRail({ s }: { s: HomepageSection }) {
  const stores = await db.store.findMany({
    where: { vendor: { status: "APPROVED" } },
    orderBy: [{ isFeatured: "desc" }, { ratingAvg: "desc" }, { createdAt: "asc" }],
    take: cfg(s).limit ?? 6,
    include: { vendor: { select: { verificationLevel: true, _count: { select: { products: { where: { status: "PUBLISHED" } } } } } } },
  });
  if (!stores.length) return null;
  return (
    <section className="container-x py-10">
      <SectionHead title={s.title ?? "Featured stores"} subtitle={s.subtitle} href="/stores" label="All stores" />
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {stores.map((st) => (
          <li key={st.id}>
            <Link href={`/store/${st.slug}`} className="flex h-full flex-col items-start gap-3 rounded-lg border border-line p-4 hover:border-line-strong">
              <span className="flex size-11 items-center justify-center overflow-hidden rounded-md bg-sunken text-sm font-semibold text-ink-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {st.logoUrl ? <img src={st.logoUrl} alt="" className="size-full object-cover" /> : st.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="flex items-center gap-1 text-[14px] font-medium leading-tight">{st.name}<VerifiedMark level={st.vendor.verificationLevel} /></span>
              <span className="text-[12px] text-ink-muted">{[st.city, st.state].filter(Boolean).join(", ") || "Nigeria"} · {st.vendor._count.products} items</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export async function BannerSection({ s }: { s: HomepageSection }) {
  const now = new Date();
  const banners = await db.banner.findMany({
    where: { placement: cfg(s).placement ?? "HOME_MID", active: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] },
    orderBy: { sortOrder: "asc" },
    take: 2,
  });
  if (!banners.length) return null;
  return (
    <section className="container-x py-6">
      <div className={cn("grid gap-4", banners.length > 1 && "md:grid-cols-2")}>
        {banners.map((b) => (
          <div key={b.id} className={cn("flex flex-col justify-between gap-6 rounded-lg p-7 sm:p-9", b.tone === "charcoal" ? "bg-ink text-white" : b.tone === "light" ? "border border-line bg-canvas" : "bg-brand-soft")}>
            <div>
              {b.eyebrow && <p className={cn("eyebrow mb-2", b.tone === "charcoal" && "text-white/60")}>{b.eyebrow}</p>}
              <p className="text-xl font-semibold leading-snug sm:text-2xl">{b.title}</p>
              {b.body && <p className={cn("mt-2 max-w-md text-sm leading-6", b.tone === "charcoal" ? "text-white/75" : "text-ink-2")}>{b.body}</p>}
            </div>
            {b.ctaHref && <ButtonLink href={b.ctaHref} variant={b.tone === "charcoal" ? "secondary" : "primary"} className="self-start">{b.ctaLabel ?? "Learn more"}</ButtonLink>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function HowItWorks({ s }: { s: HomepageSection }) {
  const steps = [
    ["Find it", "Search across products, services and digital goods, or browse stores near you. Filter by price, rating, location and stock."],
    ["Pay once", "Check out items from several sellers in a single payment. Your money is held by our payment partner, not sent straight to the seller."],
    ["Receive and review", "Each seller ships their part and you track every shipment. Confirm receipt when it arrives, or report a problem — a seller’s earnings are released only after delivery and a review period."],
  ];
  return (
    <section className="container-x py-14">
      <SectionHead title={s.title ?? "How XavierConnect works"} subtitle={s.subtitle} />
      <ol className="grid gap-8 border-t border-line pt-8 md:grid-cols-3">
        {steps.map(([t, d], i) => (
          <li key={t}>
            <span className="tabular text-sm font-semibold text-brand">0{i + 1}</span>
            <p className="mt-2 font-semibold">{t}</p>
            <p className="mt-1.5 text-sm leading-6 text-ink-muted">{d}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export async function VendorCta({ s }: { s: HomepageSection }) {
  const global = await db.commissionRule.findFirst({ where: { scope: "GLOBAL", active: true } });
  return (
    <section className="container-x py-10">
      <div className="grid gap-8 rounded-lg bg-ink p-8 text-white sm:p-12 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <p className="eyebrow text-white/60">For businesses and professionals</p>
          <h2 className="mt-2 text-2xl font-semibold leading-tight sm:text-3xl">{s.title ?? "Open your store on XavierConnect"}</h2>
          <p className="mt-3 max-w-lg text-[15px] leading-7 text-white/75">{s.subtitle ?? "Sell products, take bookings for your services or deliver digital files. You get your own storefront, an order dashboard and payouts to your Nigerian bank account."}</p>
        </div>
        <div className="space-y-4">
          <ul className="space-y-2 text-sm text-white/80">
            <li>· No setup fee on the Starter plan</li>
            {global && <li>· {global.rateBps / 100}% commission per completed sale</li>}
            <li>· Payouts to any Nigerian bank after delivery</li>
          </ul>
          <ButtonLink href="/sell" variant="secondary" size="lg">Become a vendor</ButtonLink>
        </div>
      </div>
    </section>
  );
}
