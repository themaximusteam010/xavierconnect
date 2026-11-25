import Link from "next/link";
import type { ProductCardData } from "@/server/services/catalog";
import { Price } from "./price";
import { Stars } from "./stars";
import { ProductImage } from "./product-image";
import { VerifiedMark } from "./verified";

export function ProductCard({ p }: { p: ProductCardData }) {
  const store = p.vendor.store;
  const soldOut = p.type === "PHYSICAL" && p.trackInventory && p.stockQuantity <= 0;
  return (
    <article className="group relative flex flex-col">
      <div className="relative overflow-hidden rounded-md">
        <ProductImage src={p.images[0]?.url} alt={p.images[0]?.alt ?? p.name} className="transition-transform duration-300 group-hover:scale-[1.02]" />
        {soldOut && <span className="absolute left-2 top-2 rounded-sm bg-ink/85 px-1.5 py-0.5 text-2xs font-medium text-white">Sold out</span>}
        {!soldOut && p.type === "DIGITAL" && <span className="absolute left-2 top-2 rounded-sm bg-white/95 px-1.5 py-0.5 text-2xs font-medium text-ink-2">Digital</span>}
      </div>
      <div className="mt-2.5 flex flex-1 flex-col gap-1">
        <h3 className="line-clamp-2 text-[14px] leading-snug text-ink">
          <Link href={`/p/${p.slug}`} className="after:absolute after:inset-0">{p.name}</Link>
        </h3>
        {store && (
          <p className="flex items-center gap-1 text-[12px] text-ink-muted">
            <span className="truncate">{store.name}</span>
            <VerifiedMark level={p.vendor.verificationLevel} />
          </p>
        )}
        {p.ratingCount > 0 && <Stars value={p.ratingAvg} count={p.ratingCount} size={12} />}
        <Price price={p.priceMinor} sale={p.salePriceMinor} className="mt-auto pt-1" />
      </div>
    </article>
  );
}

export function ProductGrid({ products, cols = 4 }: { products: ProductCardData[]; cols?: 4 | 5 }) {
  return (
    <div className={cols === 5 ? "grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5" : "grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4"}>
      {products.map((p) => <ProductCard key={p.id} p={p} />)}
    </div>
  );
}
