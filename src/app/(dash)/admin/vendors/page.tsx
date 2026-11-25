import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input } from "@/components/ui/form";
import type { VendorStatus } from "@prisma/client";

export const metadata = { title: "Vendors" };
const TABS: [string, string][] = [["SUBMITTED", "Awaiting review"], ["APPROVED", "Approved"], ["CHANGES_REQUESTED", "Changes requested"], ["DRAFT", "In progress"], ["REJECTED", "Rejected"], ["SUSPENDED", "Suspended"]];

export default async function Vendors({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await guard("vendor.view");
  const sp = await searchParams;
  const status = (TABS.find(([k]) => k === sp.status)?.[0] ?? "SUBMITTED") as VendorStatus;
  const list = await db.vendor.findMany({
    where: { status, ...(sp.q ? { OR: [{ businessName: { contains: sp.q, mode: "insensitive" } }, { email: { contains: sp.q, mode: "insensitive" } }] } : {}) },
    orderBy: status === "SUBMITTED" ? { submittedAt: "asc" } : { updatedAt: "desc" },
    take: 200,
    include: { store: true, owner: { select: { name: true } }, _count: { select: { documents: true, products: true } } },
  });
  return (
    <>
      <PageHeader title="Vendors" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line">
        <nav className="flex gap-1 overflow-x-auto text-sm">{TABS.map(([k, l]) => <Link key={k} href={`/admin/vendors?status=${k}`} className={`-mb-px shrink-0 border-b-2 px-3 py-2 ${status === k ? "border-ink font-medium" : "border-transparent text-ink-muted hover:text-ink"}`}>{l}</Link>)}</nav>
        <form className="pb-2"><input type="hidden" name="status" value={status} /><Input name="q" defaultValue={sp.q} placeholder="Search name or email" className="h-8 w-56" /></form>
      </div>
      <Table>
        <thead><tr><Th>Business</Th><Th>Type</Th><Th>Owner</Th><Th>Location</Th><Th>Docs</Th><Th>{status === "SUBMITTED" ? "Submitted" : "Updated"}</Th><Th>Status</Th></tr></thead>
        <tbody>
          {list.length === 0 && <tr><Td colSpan={7} className="py-8 text-center text-ink-muted">No vendors in this state.</Td></tr>}
          {list.map((v) => (
            <tr key={v.id} className="hover:bg-canvas">
              <Td><Link href={`/admin/vendors/${v.id}`} className="font-medium text-ink hover:text-brand">{v.store?.name ?? v.businessName}</Link><span className="block text-[12px] text-ink-muted">{v.email}</span></Td>
              <Td>{v.type.replace(/_/g, " ").toLowerCase()}</Td><Td>{v.owner.name}</Td><Td>{[v.city, v.state].filter(Boolean).join(", ") || "—"}</Td><Td className="tabular">{v._count.documents}</Td>
              <Td>{(status === "SUBMITTED" ? v.submittedAt : v.updatedAt)?.toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td><Td><StatusBadge status={v.status} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
