import { countryName, methodServes } from "@/lib/countries";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Flag, Heart, MapPin, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { productCardInclude, publicProductWhere } from "@/server/services/catalog";
import { toggleWishlist, reportAction } from "@/app/actions/public";
import { Gallery } from "@/components/commerce/gallery";
import { AddToCart } from "@/components/commerce/add-to-cart";
import { Price } from "@/components/commerce/price";
import { Stars } from "@/components/commerce/stars";
import { VerifiedMark } from "@/components/commerce/verified";
import { ProductGrid } from "@/components/commerce/product-card";
import { RememberViewed } from "@/components/home/recently-viewed";
import { CompareToggle } from "@/components/commerce/compare-toggle";
import { Alert } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { formatMoney } from "@/lib/money";

async function load(slug: string) {
  return db.product.findFirst({
    where: { slug, ...publicProductWhere() },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      variants: { orderBy: { createdAt: "asc" } },
      category: { include: { parent: true } },
      digitalAssets: { select: { format: true, sizeBytes: true, version: true } },
      vendor: { include: { store: true, shippingMethods: { where: { active: true } } } },
      reviews: { where: { status: "PUBLISHED" }, orderBy: { createdAt: "desc" }, take: 10, include: { user: { select: { name: true } } } },
      questions: { where: { answer: { not: null } }, orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: "Product not found" };
  return {
    title: p.seoTitle ?? p.name,
    description: p.seoDescription ?? p.shortDescription ?? p.description.slice(0, 155),
    alternates: { canonical: `/p/${p.slug}` },
    openGraph: { title: p.name, images: p.images[0] ? [p.images[0].url] : undefined },
  };
}

export default async function ProductPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ reported?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const p = await load(slug);
  if (!p) notFound();
  const user = await getCurrentUser();
  await db.$transaction([
    db.product.update({ where: { id: p.id }, data: { viewCount: { increment: 1 } } }),
    db.analyticsEvent.create({ data: { type: "PRODUCT_VIEW", vendorId: p.vendorId, productId: p.id } }),
  ]);
  const [wished, related] = await Promise.all([
    user ? db.wishlistItem.findUnique({ where: { userId_productId: { userId: user.id, productId: p.id } } }) : null,
    db.product.findMany({ where: { AND: [publicProductWhere(), { categoryId: p.categoryId, id: { not: p.id } }] }, take: 4, orderBy: { salesCount: "desc" }, include: productCardInclude }),
  ]);
  const store = p.vendor.store!;
  const digital = p.type === "DIGITAL";
  const price = p.salePriceMinor != null && p.salePriceMinor < p.priceMinor ? p.salePriceMinor : p.priceMinor;
  const attrs = Object.entries((p.attributes ?? {}) as Record<string, string>).filter(([, v]) => v);
  const ship = p.vendor.shippingMethods.find((m) => methodServes(p.vendor.country, m, "NG"));
  const abroad = p.vendor.country !== "NG";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    sku: p.sku ?? undefined,
    brand: p.brand ? { "@type": "Brand", name: p.brand } : undefined,
    image: p.images.map((i) => i.url),
    description: p.shortDescription ?? p.description.slice(0, 300),
    offers: {
      "@type": "Offer",
      priceCurrency: "NGN",
      price: (Number(price) / 100).toFixed(2),
      availability: digital || p.stockQuantity > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: store.name },
    },
    aggregateRating: p.ratingCount > 0 ? { "@type": "AggregateRating", ratingValue: p.ratingAvg.toFixed(1), reviewCount: p.ratingCount } : undefined,
  };

  return (
    <div className="container-x py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <RememberViewed slug={p.slug} name={p.name} image={p.images[0]?.url ?? null} price={formatMoney(price)} />
      <nav aria-label="Breadcrumb" className="mb-6 text-[13px] text-ink-muted">
        <Link href="/" className="hover:text-ink">Home</Link><span className="mx-1">/</span>
        {p.category.parent && <><Link href={`/shop?category=${p.category.parent.slug}`} className="hover:text-ink">{p.category.parent.name}</Link><span className="mx-1">/</span></>}
        <Link href={`/shop?category=${p.category.slug}`} className="hover:text-ink">{p.category.name}</Link>
      </nav>
      {sp.reported && <Alert tone="success" className="mb-6">Thanks. Our trust team will review this listing.</Alert>}

      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        <Gallery images={p.images} name={p.name} />

        <div>
          {p.brand && <p className="eyebrow mb-2">{p.brand}</p>}
          <h1 className="text-2xl font-semibold leading-tight sm:text-[28px]">{p.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted">
            <Stars value={p.ratingAvg} count={p.ratingCount} />
            {p.sku && <span>SKU {p.sku}</span>}
            {p.salesCount > 0 && <span>{p.salesCount.toLocaleString()} sold</span>}
          </div>
          <Price price={p.priceMinor} sale={p.salePriceMinor} size="lg" className="mt-5" />
          {p.shortDescription && <p className="mt-4 text-[15px] leading-7 text-ink-2">{p.shortDescription}</p>}

          <div className="mt-6 border-t border-line pt-6">
            <AddToCart
              productId={p.id}
              digital={digital}
              stock={p.trackInventory ? p.stockQuantity : 999}
              variants={p.variants.map((v) => ({ id: v.id, name: v.name, stock: v.stockQuantity, price: v.priceMinor?.toString() ?? null }))}
            />
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <form action={toggleWishlist}>
              <input type="hidden" name="productId" value={p.id} /><input type="hidden" name="back" value={`/p/${p.slug}`} />
              <button className="flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink"><Heart className={wished ? "size-4 fill-danger text-danger" : "size-4"} />{wished ? "Saved to wishlist" : "Save to wishlist"}</button>
            </form>
            <CompareToggle slug={p.slug} />
            </div>
          </div>

          <ul className="mt-6 space-y-3 rounded-lg border border-line p-4 text-[13px] text-ink-2">
            {digital ? (
              <li className="flex gap-3"><ShieldCheck className="size-4 shrink-0 text-ink-muted" />Instant download after payment is confirmed. {p.digitalAssets[0] && `${p.digitalAssets[0].format.toUpperCase()}, ${(p.digitalAssets[0].sizeBytes / 1_048_576).toFixed(1)} MB, version ${p.digitalAssets[0].version}.`}</li>
            ) : (
              <li className="flex gap-3"><Truck className="size-4 shrink-0 text-ink-muted" />{ship ? <>Ships from {abroad ? `${store.city ? `${store.city}, ` : ""}${countryName(p.vendor.country)}` : store.city ?? store.state ?? "Nigeria"} · {ship.name}{ship.rateMinor > 0n ? ` from ${formatMoney(ship.rateMinor)}` : " (free)"} · {ship.etaDaysMin}–{ship.etaDaysMax} days{abroad && <span className="block text-[12px] text-warning">International shipment — import duties and taxes may apply on arrival.</span>}</> : "Delivery options are confirmed at checkout."}</li>
            )}
            <li className="flex gap-3"><RotateCcw className="size-4 shrink-0 text-ink-muted" />{p.returnInfo ?? (p.refundable ? "Returns accepted within 7 days of delivery for items not as described." : "This item is not eligible for return.")}</li>
            <li className="flex gap-3"><ShieldCheck className="size-4 shrink-0 text-ink-muted" />The seller&apos;s earnings are released only after delivery and a review period. Report a problem before then and we pause them.</li>
          </ul>

          <div className="mt-6 flex items-center justify-between rounded-lg bg-canvas p-4">
            <div>
              <p className="text-[12px] text-ink-muted">Sold by</p>
              <Link href={`/store/${store.slug}`} className="flex items-center gap-1 font-medium hover:text-brand">{store.name}<VerifiedMark level={p.vendor.verificationLevel} withLabel /></Link>
              {(store.city || store.state) && <p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-muted"><MapPin className="size-3" />{[store.city, store.state].filter(Boolean).join(", ")}</p>}
            </div>
            <span className="flex flex-col items-end gap-1">
              <Link href={`/store/${store.slug}`} className="text-[13px] font-medium text-brand hover:underline">Visit store</Link>
              <a href={`/messages/start?vendor=${p.vendorId}&product=${p.id}`} className="text-[13px] font-medium text-brand hover:underline" data-testid="message-seller">Message seller</a>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-14 grid gap-12 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-12">
          <section>
            <h2 className="mb-4 text-lg font-semibold">Description</h2>
            <div className="prose-xc whitespace-pre-line">{p.description}</div>
          </section>
          {(attrs.length > 0 || p.weightGrams || p.warranty) && (
            <section>
              <h2 className="mb-4 text-lg font-semibold">Specifications</h2>
              <dl className="divide-y divide-line rounded-lg border border-line text-sm">
                {attrs.map(([k, v]) => <div key={k} className="grid grid-cols-[160px_1fr] px-4 py-2.5"><dt className="capitalize text-ink-muted">{k}</dt><dd>{v}</dd></div>)}
                {p.weightGrams && <div className="grid grid-cols-[160px_1fr] px-4 py-2.5"><dt className="text-ink-muted">Weight</dt><dd>{(p.weightGrams / 1000).toFixed(2)} kg</dd></div>}
                {p.lengthCm && <div className="grid grid-cols-[160px_1fr] px-4 py-2.5"><dt className="text-ink-muted">Dimensions</dt><dd>{p.lengthCm} × {p.widthCm} × {p.heightCm} cm</dd></div>}
                {p.warranty && <div className="grid grid-cols-[160px_1fr] px-4 py-2.5"><dt className="text-ink-muted">Warranty</dt><dd>{p.warranty}</dd></div>}
                {p.licenceTerms && <div className="grid grid-cols-[160px_1fr] px-4 py-2.5"><dt className="text-ink-muted">Licence</dt><dd>{p.licenceTerms}</dd></div>}
              </dl>
            </section>
          )}
          <section id="reviews">
            <div className="mb-4 flex items-baseline justify-between"><h2 className="text-lg font-semibold">Reviews</h2><Stars value={p.ratingAvg} count={p.ratingCount} /></div>
            {p.reviews.length === 0 ? (
              <p className="text-sm text-ink-muted">No reviews yet. Reviews can only be left by customers who bought this item.</p>
            ) : (
              <ul className="divide-y divide-line">
                {p.reviews.map((r) => (
                  <li key={r.id} className="py-5">
                    <div className="flex items-center gap-3"><Stars value={r.rating} /><span className="text-[13px] font-medium">{r.user.name.split(" ")[0]}</span>{r.verified && <span className="text-[12px] text-success">Verified purchase</span>}<span className="text-[12px] text-ink-muted">{r.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</span></div>
                    {r.title && <p className="mt-2 font-medium">{r.title}</p>}
                    <p className="mt-1 text-sm leading-6 text-ink-2">{r.body}</p>
                    {r.vendorResponse && <p className="mt-3 border-l-2 border-line pl-3 text-[13px] text-ink-muted"><span className="font-medium text-ink-2">Response from {store.name}:</span> {r.vendorResponse}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {p.questions.length > 0 && (
            <section>
              <h2 className="mb-4 text-lg font-semibold">Questions and answers</h2>
              <dl className="space-y-4 text-sm">{p.questions.map((q) => <div key={q.id}><dt className="font-medium">Q: {q.question}</dt><dd className="mt-1 text-ink-2">A: {q.answer}</dd></div>)}</dl>
            </section>
          )}
        </div>
        <aside>
          <details className="rounded-lg border border-line p-4 text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-ink-2"><Flag className="size-4" />Report this listing</summary>
            <form action={reportAction} className="mt-3 space-y-3">
              <input type="hidden" name="targetType" value="PRODUCT" /><input type="hidden" name="targetId" value={p.id} /><input type="hidden" name="back" value={`/p/${p.slug}`} />
              <Select name="reason" aria-label="Reason">{["Counterfeit or fake", "Prohibited item", "Misleading information", "Offensive content", "Fraud or scam", "Other"].map((r) => <option key={r}>{r}</option>)}</Select>
              <textarea name="details" rows={3} maxLength={1000} placeholder="Anything else we should know (optional)" className="w-full rounded-md border border-line-strong p-2 text-sm" />
              <button className="text-sm font-medium text-brand">Submit report</button>
            </form>
          </details>
        </aside>
      </div>

      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="mb-5 text-lg font-semibold">More in {p.category.name}</h2>
          <ProductGrid products={related} />
        </section>
      )}
    </div>
  );
}
