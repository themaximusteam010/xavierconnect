import Link from "next/link";
import { db } from "@/server/db";
import { VerifiedMark } from "@/components/commerce/verified";
import { Stars } from "@/components/commerce/stars";
import { Pagination } from "@/components/ui/pagination";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { NIGERIAN_STATES } from "@/lib/validation";

export const metadata = { title: "Stores", description: "Browse independent stores and service providers on XavierConnect." };

export default async function Stores({ searchParams }: { searchParams: Promise<{ q?: string; state?: string; page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = {
    vendor: { status: "APPROVED" as const, ...(sp.state ? { state: sp.state } : {}) },
    ...(sp.q ? { name: { contains: sp.q, mode: "insensitive" as const } } : {}),
  };
  const [stores, total] = await Promise.all([
    db.store.findMany({ where, orderBy: [{ isFeatured: "desc" }, { ratingAvg: "desc" }, { name: "asc" }], skip: (page - 1) * 24, take: 24, include: { vendor: { select: { verificationLevel: true, type: true, _count: { select: { products: { where: { status: "PUBLISHED" } }, services: { where: { status: "PUBLISHED" } } } } } } } }),
    db.store.count({ where }),
  ]);
  return (
    <div className="container-x py-10">
      <h1 className="text-2xl font-semibold">Stores</h1>
      <p className="mt-1 text-sm text-ink-muted">{total} independent sellers and service providers</p>
      <form className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Input name="q" defaultValue={sp.q} placeholder="Search stores" className="sm:max-w-xs" aria-label="Search stores" />
        <Select name="state" defaultValue={sp.state ?? ""} className="sm:max-w-[200px]" aria-label="State"><option value="">All states</option>{NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stores.map((s) => (
          <li key={s.id}>
            <Link href={`/store/${s.slug}`} className="flex gap-4 rounded-lg border border-line p-4 hover:border-line-strong">
              <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-sunken font-semibold text-ink-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {s.logoUrl ? <img src={s.logoUrl} alt="" className="size-full object-cover" /> : s.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 font-medium">{s.name}<VerifiedMark level={s.vendor.verificationLevel} /></span>
                {s.tagline && <span className="block truncate text-[13px] text-ink-muted">{s.tagline}</span>}
                <span className="mt-1 block text-[12px] text-ink-muted">{[s.city, s.state].filter(Boolean).join(", ")} · {s.vendor._count.products} products{s.vendor._count.services ? ` · ${s.vendor._count.services} services` : ""}</span>
                {s.ratingCount > 0 && <Stars value={s.ratingAvg} count={s.ratingCount} size={12} className="mt-1" />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Pagination page={page} pages={Math.ceil(total / 24)} href={(p) => `/stores?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.state ? { state: sp.state } : {}), page: String(p) })}`} />
    </div>
  );
}
