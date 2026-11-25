import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { adapterName } from "@/server/services/payouts";
import { FilterBar, qs } from "@/components/admin/filters";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, Badge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { countryName } from "@/lib/countries";
import type { Prisma } from "@prisma/client";
import { reviewBeneficiaryAction } from "@/app/actions/admin-ops";
import { SubmitButton } from "@/components/ui/submit-button";
import { FlashFromQuery } from "@/components/ui/feedback";

export const metadata = { title: "Bank accounts" };
type SP = { ok?: string; error?: string; status?: string; country?: string; provider?: string; q?: string; page?: string };

export default async function Beneficiaries({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await guard("finance.view");
  const canReview = u.permissions.has("finance.payout.approve");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.BeneficiaryWhereInput = {
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(sp.country ? { country: sp.country } : {}),
    ...(sp.provider ? { providerKey: sp.provider } : {}),
    ...(sp.q ? { OR: [{ accountHolderName: { contains: sp.q, mode: "insensitive" } }, { vendor: { businessName: { contains: sp.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.beneficiary.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { vendor: { select: { id: true, businessName: true } }, _count: { select: { payouts: true } } } }),
    db.beneficiary.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Bank accounts" description="Vendor payout beneficiaries. Only the last four digits are stored in clear; full details are encrypted at rest. They are removed once a payout provider has tokenised the account, and kept (encrypted) only for manually-paid accounts, which finance verifies with the bank before the first withdrawal." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <FilterBar action="/admin/beneficiaries" values={sp} fields={[
        { type: "search", name: "q", placeholder: "Vendor or account holder" },
        { type: "select", name: "status", label: "Verification", options: [["VERIFIED", "Verified"], ["PENDING_VERIFICATION", "Pending"], ["REJECTED", "Rejected"], ["DISABLED", "Disabled"]] },
        { type: "select", name: "country", label: "Country", options: [["NG", "Nigeria"], ["CN", "China"], ["GH", "Ghana"], ["KE", "Kenya"], ["ZA", "South Africa"], ["GB", "United Kingdom"], ["US", "United States"]] },
        { type: "select", name: "provider", label: "Provider", options: [["manual", "Manual"], ["paystack", "Paystack"], ["sandbox-payouts", "Sandbox domestic"], ["sandbox-crossborder", "Sandbox cross-border"]] },
      ]} />
      <Table>
        <thead><tr><Th>Vendor</Th><Th>Account holder</Th><Th>Bank</Th><Th>Routing</Th><Th>Country / currency</Th><Th>Provider</Th><Th>Status</Th><Th>Payouts</Th><Th>Added</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={9} className="py-8 text-center text-ink-muted">No accounts match.</Td></tr>}
          {rows.map((b) => (
            <tr key={b.id}>
              <Td><Link href={`/admin/vendors/${b.vendor.id}`} className="font-medium text-ink hover:text-brand">{b.vendor.businessName}</Link>{b.isDefault && <Badge tone="brand" className="ml-1">default</Badge>}</Td>
              <Td>{b.accountHolderName}{b.verifiedName && b.verifiedName !== b.accountHolderName && <span className="block text-[11px] text-ink-muted">Bank name: {b.verifiedName}</span>}</Td>
              <Td>{b.bankName}{b.branch ? `, ${b.branch}` : ""} <span className="tabular text-ink-muted">••••{b.accountLast4}</span></Td>
              <Td>{b.routingType}</Td>
              <Td>{countryName(b.country)} · {b.currency}</Td>
              <Td>{adapterName(b.providerKey)}</Td>
              <Td><StatusBadge status={b.status === "PENDING_VERIFICATION" ? "PENDING_REVIEW" : b.status === "VERIFIED" ? "APPROVED" : b.status === "DISABLED" ? "ARCHIVED" : "REJECTED"} />{b.failureReason && <span className="block text-[11px] text-danger">{b.failureReason}</span>}
                {canReview && b.providerKey === "manual" && b.status === "PENDING_VERIFICATION" && (
                  <form action={reviewBeneficiaryAction} className="mt-2 flex flex-col gap-1">
                    <input type="hidden" name="id" value={b.id} />
                    <input name="note" placeholder="Name confirmed by bank / reason" className="h-7 rounded border border-line-strong px-2 text-[12px]" />
                    <span className="flex gap-1"><SubmitButton name="decision" value="VERIFIED" size="sm">Verify</SubmitButton><SubmitButton name="decision" value="REJECTED" size="sm" variant="ghost">Reject</SubmitButton></span>
                  </form>
                )}</Td>
              <Td className="tabular">{b._count.payouts}</Td>
              <Td>{b.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(n) => qs("/admin/beneficiaries", { ...sp, page: n })} />
    </>
  );
}
