import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input } from "@/components/ui/form";
import { countryName, VENDOR_COUNTRIES } from "@/lib/countries";
import type { VendorStatus } from "@prisma/client";

export const metadata = { title: "Vendors" };
const TABS: [string, string][] = [["SUBMITTED", "Awaiting review"], ["APPROVED", "Approved"], ["CHANGES_REQUESTED", "Changes requested"], ["DRAFT", "In progress"], ["REJECTED", "Rejected"], ["SUSPENDED", "Suspended"]];

export default async function Vendors({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; country?: string; type?: string }> }) {
  await guard("vendor.view");
  const sp = await searchParams;
  const status = (TABS.find(([k]) => k === sp.status)?.[0] ?? "SUBMITTED") as VendorStatus;
  const list = await db.vendor.findMany({
    where: { status, ...(sp.country ? { country: sp.country } : {}), ...(sp.type ? { type: sp.type as never } : {}), ...(sp.q ? { OR: [{ businessName: { contains: sp.q, mode: "insensitive" } }, { email: { contains: sp.q, mode: "insensitive" } }] } : {}) },
    orderBy: status === "SUBMITTED" ? { submittedAt: "asc" } : { updatedAt: "desc" },
    take: 200,
    include: { store: true, owner: { select: { name: true } }, _count: { select: { documents: true, products: true } } },
  });
  return (
    <>
      <PageHeader title="Vendors" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line">
        <nav className="flex gap-1 overflow-x-auto text-sm">{TABS.map(([k, l]) => <Link key={k} href={`/admin/vendors?status=${k}`} className={`-mb-px shrink-0 border-b-2 px-3 py-2 ${status === k ? "border-ink font-medium" : "border-transparent text-ink-muted hover:text-ink"}`}>{l}</Link>)}</nav>
        <form className="flex gap-2 pb-2"><input type="hidden" name="status" value={status} />
          <select name="country" defaultValue={sp.country ?? ""} aria-label="Country" className="h-8 rounded-md border border-line-strong bg-white px-2 text-[13px]"><option value="">All countries</option>{VENDOR_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
          <select name="type" defaultValue={sp.type ?? ""} aria-label="Type" className="h-8 rounded-md border border-line-strong bg-white px-2 text-[13px]"><option value="">All types</option><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business</option><option value="SERVICE_PROVIDER">Service provider</option></select>
          <Input name="q" defaultValue={sp.q} placeholder="Search name or email" className="h-8 w-56" /><button className="h-8 rounded-md bg-ink px-3 text-[13px] text-white">Filter</button></form>
      </div>
      <Table>
        <thead><tr><Th>Business</Th><Th>Type</Th><Th>Owner</Th><Th>Location</Th><Th>Docs</Th><Th>{status === "SUBMITTED" ? "Submitted" : "Updated"}</Th><Th>Status</Th></tr></thead>
        <tbody>
          {list.length === 0 && <tr><Td colSpan={7} className="py-8 text-center text-ink-muted">No vendors in this state.</Td></tr>}
          {list.map((v) => (
            <tr key={v.id} className="hover:bg-canvas">
              <Td><Link href={`/admin/vendors/${v.id}`} className="font-medium text-ink hover:text-brand">{v.store?.name ?? v.businessName}</Link><span className="block text-[12px] text-ink-muted">{v.email}</span></Td>
              <Td>{v.type.replace(/_/g, " ").toLowerCase()}</Td><Td>{v.owner.name}</Td><Td>{[v.city, v.state ?? v.region].filter(Boolean).join(", ") || "—"}<span className="block text-[11px] text-ink-muted">{countryName(v.country)}</span></Td><Td className="tabular">{v._count.documents}</Td>
              <Td>{(status === "SUBMITTED" ? v.submittedAt : v.updatedAt)?.toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td><Td><StatusBadge status={v.status} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
