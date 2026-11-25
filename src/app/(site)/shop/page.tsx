import Link from "next/link";
import type { Metadata } from "next";
import { SlidersHorizontal, SearchX } from "lucide-react";
import { db } from "@/server/db";
import { searchProducts, type ShopQuery } from "@/server/services/catalog";
import { ProductGrid } from "@/components/commerce/product-card";
import { AutoSubmitSelect } from "@/components/commerce/auto-submit-select";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/feedback";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { NIGERIAN_STATES } from "@/lib/validation";

type SP = Promise<ShopQuery>;

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const sp = await searchParams;
  const cat = sp.category ? await db.category.findUnique({ where: { slug: sp.category } }) : null;
  const title = sp.q ? `Results for “${sp.q}”` : cat ? cat.name : sp.onSale ? "Deals" : sp.type === "digital" ? "Digital products" : "Shop all products";
  const page = Number(sp.page) || 1;
  return {
    title,
    description: cat?.description ?? "Browse products from independent sellers across Nigeria.",
    alternates: { canonical: `/shop${cat ? `?category=${cat.slug}` : ""}${page > 1 ? `${cat ? "&" : "?"}page=${page}` : ""}` },
    robots: sp.q ? { index: false } : undefined,
  };
}

function qs(sp: ShopQuery, patch: Partial<ShopQuery>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) u.set(k, String(v));
  const s = u.toString();
  return `/shop${s ? `?${s}` : ""}`;
}

export default async function ShopPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [res, cats] = await Promise.all([
    searchProducts(sp),
    db.category.findMany({ where: { parentId: null, kind: { in: ["PRODUCT", "DIGITAL"] } }, orderBy: { sortOrder: "asc" }, include: { children: { orderBy: { sortOrder: "asc" } } } }),
  ]);
  const heading = sp.q ? `Results for “${sp.q}”` : res.category?.name ?? (sp.onSale ? "Deals" : sp.type === "digital" ? "Digital products" : "All products");
  const activeFilters = ["min", "max", "rating", "state", "inStock", "onSale", "type"].filter((k) => sp[k as keyof ShopQuery]).length;

  const filters = (
    <div className="space-y-7">
      <div>
        <p className="eyebrow mb-3">Category</p>
        <ul className="space-y-1.5 text-sm">
          <li><Link href={qs(sp, { category: undefined, page: undefined })} className={!sp.category ? "font-medium text-ink" : "text-ink-2 hover:text-brand"}>All categories</Link></li>
          {cats.map((c) => (
            <li key={c.id}>
              <Link href={qs(sp, { category: c.slug, page: undefined })} className={sp.category === c.slug ? "font-medium text-ink" : "text-ink-2 hover:text-brand"}>{c.name}</Link>
              {(sp.category === c.slug || c.children.some((ch) => ch.slug === sp.category)) && c.children.length > 0 && (
                <ul className="ml-3 mt-1.5 space-y-1.5 border-l border-line pl-3">
                  {c.children.map((ch) => <li key={ch.id}><Link href={qs(sp, { category: ch.slug, page: undefined })} className={sp.category === ch.slug ? "font-medium text-ink" : "text-ink-2 hover:text-brand"}>{ch.name}</Link></li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
      <form action="/shop" className="space-y-6">
        {sp.q && <input type="hidden" name="q" value={sp.q} />}
        {sp.category && <input type="hidden" name="category" value={sp.category} />}
        {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
        <fieldset>
          <legend className="eyebrow mb-3">Price (₦)</legend>
          <div className="flex items-center gap-2">
            <Input name="min" inputMode="numeric" pattern="\d*" placeholder="Min" defaultValue={sp.min} aria-label="Minimum price" />
            <span className="text-ink-faint">–</span>
            <Input name="max" inputMode="numeric" pattern="\d*" placeholder="Max" defaultValue={sp.max} aria-label="Maximum price" />
          </div>
        </fieldset>
        <fieldset>
          <legend className="eyebrow mb-3">Rating</legend>
          <Select name="rating" defaultValue={sp.rating ?? ""} aria-label="Minimum rating">
            <option value="">Any rating</option>
            {[4, 3, 2].map((r) => <option key={r} value={r}>{r} stars & up</option>)}
          </Select>
        </fieldset>
        <fieldset>
          <legend className="eyebrow mb-3">Seller location</legend>
          <Select name="state" defaultValue={sp.state ?? ""} aria-label="Seller state">
            <option value="">Anywhere in Nigeria</option>
            {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </fieldset>
        <fieldset className="space-y-2.5 text-sm text-ink-2">
          <legend className="eyebrow mb-3">Availability</legend>
          <label className="flex items-center gap-2"><input type="checkbox" name="inStock" value="1" defaultChecked={sp.inStock === "1"} className="size-4 accent-[var(--color-brand)]" />In stock only</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="onSale" value="1" defaultChecked={sp.onSale === "1"} className="size-4 accent-[var(--color-brand)]" />On sale</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="type" value="digital" defaultChecked={sp.type === "digital"} className="size-4 accent-[var(--color-brand)]" />Digital downloads</label>
        </fieldset>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1">Apply</Button>
          {activeFilters > 0 && <ButtonLink href={qs({ q: sp.q, category: sp.category }, {})} variant="ghost">Clear</ButtonLink>}
        </div>
      </form>
    </div>
  );

  return (
    <div className="container-x py-8">
      <nav aria-label="Breadcrumb" className="mb-4 text-[13px] text-ink-muted">
        <Link href="/" className="hover:text-ink">Home</Link> <span className="mx-1">/</span> <Link href="/shop" className="hover:text-ink">Shop</Link>
        {res.category && <><span className="mx-1">/</span><span className="text-ink">{res.category.name}</span></>}
      </nav>
      <div className="flex flex-col gap-1 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{heading}</h1>
          <p className="tabular mt-1 text-sm text-ink-muted">{res.total.toLocaleString("en-NG")} {res.total === 1 ? "result" : "results"}</p>
        </div>
        <form action="/shop" className="flex items-center gap-2">
          {Object.entries(sp).filter(([k, v]) => v && k !== "sort" && k !== "page").map(([k, v]) => <input key={k} type="hidden" name={k} value={v as string} />)}
          <label htmlFor="sort" className="text-[13px] text-ink-muted">Sort</label>
          <AutoSubmitSelect id="sort" name="sort" defaultValue={sp.sort ?? (sp.q ? "relevance" : "newest")} className="h-9 w-44">
            {sp.q && <option value="relevance">Most relevant</option>}
            <option value="newest">Newest</option>
            <option value="popular">Most popular</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="rating">Highest rated</option>
          </AutoSubmitSelect>
          <noscript><Button type="submit" size="sm" variant="secondary">Sort</Button></noscript>
        </form>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">{filters}</aside>
        <details className="rounded-md border border-line lg:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium"><SlidersHorizontal className="size-4" />Filters{activeFilters > 0 && <span className="text-brand">({activeFilters})</span>}</summary>
          <div className="border-t border-line p-4">{filters}</div>
        </details>
        <div>
          {res.items.length ? (
            <>
              <ProductGrid products={res.items} />
              <Pagination page={res.page} pages={res.pages} href={(p) => qs(sp, { page: p > 1 ? String(p) : undefined })} />
            </>
          ) : (
            <EmptyState icon={SearchX} title="Nothing matches those filters" action={<ButtonLink href="/shop" variant="secondary">Clear all filters</ButtonLink>}>
              Try a broader search, remove a filter, or browse a different category.
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
