import Link from "next/link";
import { db } from "@/server/db";
import { publicProductWhere } from "@/server/services/catalog";
import { ProductImage } from "@/components/commerce/product-image";
import { Price } from "@/components/commerce/price";
import { Stars } from "@/components/commerce/stars";
import { EmptyState } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "Compare products", robots: { index: false } };

export default async function Compare({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const slugs = ((await searchParams).p ?? "").split(",").filter(Boolean).slice(0, 4);
  const items = slugs.length ? await db.product.findMany({ where: { AND: [publicProductWhere(), { slug: { in: slugs } }] }, include: { images: { take: 1 }, vendor: { include: { store: true } }, category: true } }) : [];
  if (items.length < 2) return <div className="container-x py-12"><h1 className="mb-6 text-2xl font-semibold">Compare products</h1><EmptyState title="Add at least two products to compare" action={<ButtonLink href="/shop" variant="secondary">Browse products</ButtonLink>}>Use “Add to compare” on any product page.</EmptyState></div>;
  const keys = [...new Set(items.flatMap((p) => Object.entries((p.attributes ?? {}) as Record<string, string>).filter(([, v]) => v).map(([k]) => k)))];
  const row = (label: string, cell: (p: (typeof items)[number]) => React.ReactNode) => <tr className="border-b border-line"><th className="w-40 py-3 pr-4 text-left align-top text-[13px] font-medium text-ink-muted">{label}</th>{items.map((p) => <td key={p.id} className="py-3 pr-4 align-top text-sm">{cell(p)}</td>)}</tr>;
  return (
    <div className="container-x py-10">
      <h1 className="mb-6 text-2xl font-semibold">Compare products</h1>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <tbody>
            {row("", (p) => <Link href={`/p/${p.slug}`} className="block max-w-56"><ProductImage src={p.images[0]?.url} alt={p.name} className="rounded-md" /><span className="mt-2 block font-medium hover:text-brand">{p.name}</span></Link>)}
            {row("Price", (p) => <Price price={p.priceMinor} sale={p.salePriceMinor} />)}
            {row("Rating", (p) => <Stars value={p.ratingAvg} count={p.ratingCount} />)}
            {row("Seller", (p) => p.vendor.store?.name)}
            {row("Category", (p) => p.category.name)}
            {row("Brand", (p) => p.brand ?? "—")}
            {row("Availability", (p) => p.type === "DIGITAL" ? "Instant download" : p.stockQuantity > 0 ? `${p.stockQuantity} in stock` : "Sold out")}
            {keys.map((k) => row(k[0].toUpperCase() + k.slice(1), (p) => ((p.attributes ?? {}) as Record<string, string>)[k] || "—"))}
            {row("Weight", (p) => (p.weightGrams ? `${(p.weightGrams / 1000).toFixed(2)} kg` : "—"))}
            {row("Warranty", (p) => p.warranty ?? "—")}
          </tbody>
        </table>
      </div>
    </div>
  );
}
