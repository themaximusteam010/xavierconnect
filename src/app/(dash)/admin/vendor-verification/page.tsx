import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { FilterBar } from "@/components/admin/filters";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, Badge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { countryName, VENDOR_COUNTRIES } from "@/lib/countries";

export const metadata = { title: "Vendor verification" };

export default async function VendorVerification({ searchParams }: { searchParams: Promise<{ queue?: string; country?: string; type?: string }> }) {
  await guard("vendor.view");
  const sp = await searchParams;
  const statuses = sp.queue === "changes" ? ["CHANGES_REQUESTED"] : ["SUBMITTED"];
  const vendors = await db.vendor.findMany({
    where: { status: { in: statuses as never }, ...(sp.country ? { country: sp.country } : {}), ...(sp.type ? { type: sp.type as never } : {}) },
    orderBy: { submittedAt: "asc" },
    include: { owner: { select: { name: true, emailVerifiedAt: true } }, documents: { select: { status: true, type: true } }, beneficiaries: { select: { status: true } }, payoutAccount: { select: { id: true } } },
  });
  const [benPending, docPending] = await Promise.all([db.beneficiary.count({ where: { status: "PENDING_VERIFICATION" } }), db.vendorDocument.count({ where: { status: "PENDING", vendor: { status: { in: ["SUBMITTED", "APPROVED"] } } } })]);
  return (
    <>
      <PageHeader title="Vendor verification" description="Applications are reviewed oldest first. Open an application to view documents, check the payout account and record a decision." />
      <div className="mb-4 flex flex-wrap gap-2 text-[13px]">
        <Link href="/admin/vendor-verification" className={`rounded-full border px-3 py-1 ${!sp.queue ? "border-ink bg-ink text-white" : "border-line"}`}>Awaiting review</Link>
        <Link href="/admin/vendor-verification?queue=changes" className={`rounded-full border px-3 py-1 ${sp.queue === "changes" ? "border-ink bg-ink text-white" : "border-line"}`}>Changes requested</Link>
        <Link href="/admin/beneficiaries?status=PENDING_VERIFICATION" className="rounded-full border border-line px-3 py-1">Bank accounts to verify ({benPending})</Link>
        <span className="rounded-full border border-line px-3 py-1 text-ink-muted">Documents pending: {docPending}</span>
      </div>
      <FilterBar action="/admin/vendor-verification" values={sp} fields={[
        { type: "select", name: "country", label: "Country", options: VENDOR_COUNTRIES.map((c) => [c.code, c.name] as [string, string]) },
        { type: "select", name: "type", label: "Type", options: [["INDIVIDUAL", "Individual"], ["BUSINESS", "Registered business"], ["SERVICE_PROVIDER", "Service provider"]] },
      ]} extra={sp.queue ? <input type="hidden" name="queue" value={sp.queue} /> : undefined} />
      <Table>
        <thead><tr><Th>Applicant</Th><Th>Type</Th><Th>Country</Th><Th>Documents</Th><Th>Payout account</Th><Th>Waiting</Th><Th>Status</Th></tr></thead>
        <tbody>
          {vendors.length === 0 && <tr><Td colSpan={7} className="py-8 text-center text-ink-muted">Queue is empty.</Td></tr>}
          {vendors.map((v) => {
            const days = v.submittedAt ? Math.floor((Date.now() - v.submittedAt.getTime()) / 864e5) : 0;
            const docs = { total: v.documents.length, pending: v.documents.filter((d) => d.status === "PENDING").length, rejected: v.documents.filter((d) => d.status === "REJECTED").length };
            const ben = v.beneficiaries.find((b) => b.status === "VERIFIED") ? "verified" : v.beneficiaries.length ? "pending" : v.payoutAccount ? "legacy" : "missing";
            return (
              <tr key={v.id} className="hover:bg-canvas">
                <Td><Link href={`/admin/vendors/${v.id}`} className="font-medium text-ink hover:text-brand">{v.businessName}</Link><span className="block text-[12px] text-ink-muted">{v.owner.name}{!v.owner.emailVerifiedAt && " · email unverified"}</span></Td>
                <Td>{v.type.replace(/_/g, " ").toLowerCase()}{v.rcNumber && <span className="block text-[11px] text-ink-muted">RC {v.rcNumber}</span>}</Td>
                <Td>{countryName(v.country)}{v.payoutCurrency !== "NGN" && <span className="block text-[11px] text-ink-muted">paid in {v.payoutCurrency}</span>}</Td>
                <Td>{docs.total}{docs.pending > 0 && <Badge tone="warning" className="ml-1">{docs.pending} to check</Badge>}{docs.rejected > 0 && <Badge tone="danger" className="ml-1">{docs.rejected} rejected</Badge>}</Td>
                <Td><Badge tone={ben === "verified" ? "success" : ben === "missing" ? "danger" : "warning"}>{ben}</Badge></Td>
                <Td className={days > 2 ? "text-warning" : ""}>{days} days</Td>
                <Td><StatusBadge status={v.status} /></Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
