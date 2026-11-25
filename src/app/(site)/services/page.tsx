import Link from "next/link";
import { Wrench } from "lucide-react";
import { db } from "@/server/db";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Stars } from "@/components/commerce/stars";
import { VerifiedMark } from "@/components/commerce/verified";
import { formatMoney } from "@/lib/money";
import { NIGERIAN_STATES } from "@/lib/validation";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Services", description: "Book trusted professionals — design, repairs, cleaning, events, tutoring and more." };

export default async function Services({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; state?: string; remote?: string }> }) {
  const sp = await searchParams;
  const cats = await db.category.findMany({ where: { kind: "SERVICE", parentId: { not: null } }, orderBy: { sortOrder: "asc" }, include: { _count: { select: { services: { where: { status: "PUBLISHED" } } } } } });
  const cat = sp.category ? cats.find((c) => c.slug === sp.category) : null;
  const where: Prisma.ServiceWhereInput = {
    status: "PUBLISHED", deletedAt: null, vendor: { status: "APPROVED" },
    ...(cat ? { categoryId: cat.id } : {}),
    ...(sp.state ? { OR: [{ state: sp.state }, { location: { in: ["REMOTE", "BOTH"] } }] } : {}),
    ...(sp.remote === "1" ? { location: { in: ["REMOTE", "BOTH"] } } : {}),
    ...(sp.q ? { title: { contains: sp.q, mode: "insensitive" } } : {}),
  };
  const services = await db.service.findMany({ where, orderBy: [{ isFeatured: "desc" }, { ratingAvg: "desc" }, { createdAt: "desc" }], take: 48, include: { packages: { orderBy: { priceMinor: "asc" } }, category: true, vendor: { include: { store: true } } } });
  return (
    <div className="container-x py-10">
      <h1 className="text-2xl font-semibold">{cat?.name ?? "Services"}</h1>
      <p className="mt-1 text-sm text-ink-muted">Choose a package, pick a time that suits you and pay securely. Providers are paid after the job is done.</p>
      <form className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Input name="q" defaultValue={sp.q} placeholder="What do you need done?" className="sm:max-w-xs" aria-label="Search services" />
        <Select name="category" defaultValue={sp.category ?? ""} className="sm:max-w-[220px]" aria-label="Category"><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}</Select>
        <Select name="state" defaultValue={sp.state ?? ""} className="sm:max-w-[180px]" aria-label="State"><option value="">Anywhere</option>{NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select>
        <label className="flex items-center gap-2 px-2 text-sm"><input type="checkbox" name="remote" value="1" defaultChecked={sp.remote === "1"} className="size-4 accent-[var(--color-brand)]" />Remote only</label>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      <div className="mt-6 flex flex-wrap gap-2">
        {cats.filter((c) => c._count.services > 0).map((c) => <Link key={c.id} href={`/services?category=${c.slug}`} className={`rounded-full border px-3 py-1 text-[13px] ${sp.category === c.slug ? "border-ink bg-ink text-white" : "border-line-strong text-ink-2 hover:border-ink"}`}>{c.name}</Link>)}
      </div>
      {services.length === 0 ? <EmptyState icon={Wrench} title="No services match yet" className="mt-8">Try another category or location.</EmptyState> : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <li key={s.id}>
              <Link href={`/services/${s.slug}`} className="flex h-full flex-col rounded-lg border border-line p-5 hover:border-line-strong">
                <span className="eyebrow">{s.category.name}</span>
                <span className="mt-2 font-medium leading-snug">{s.title}</span>
                {s.summary && <span className="mt-1 line-clamp-2 text-[13px] text-ink-muted">{s.summary}</span>}
                <span className="mt-3 flex items-center gap-1 text-[13px] text-ink-2">{s.vendor.store?.name}<VerifiedMark level={s.vendor.verificationLevel} /></span>
                <span className="text-[12px] text-ink-muted">{s.location === "REMOTE" ? "Remote" : s.location === "BOTH" ? `Remote or in ${s.state}` : [s.city, s.state].filter(Boolean).join(", ")}</span>
                <span className="mt-auto flex items-end justify-between pt-4">
                  {s.ratingCount > 0 ? <Stars value={s.ratingAvg} count={s.ratingCount} size={12} /> : <span />}
                  {s.packages[0] && <span className="tabular text-sm">From <span className="font-semibold">{formatMoney(s.packages[0].priceMinor)}</span></span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
