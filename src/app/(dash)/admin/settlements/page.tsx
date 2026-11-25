import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { getSetting } from "@/server/services/settings";
import { STRONG_EVIDENCE } from "@/server/services/finance";
import { FilterBar, qs } from "@/components/admin/filters";
import { Kpi } from "@/components/admin/charts";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { ButtonLink } from "@/components/ui/button";
import { runSettlementAction } from "@/app/actions/admin";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Settlements" };
type SP = { state?: string; currency?: string; vendor?: string; q?: string; page?: string };

export default async function Settlements({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await guard("finance.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [hold, claimHold] = await Promise.all([getSetting(db, "settlementHoldDays"), getSetting(db, "vendorClaimHoldDays")]);
  const openDispute = { some: { status: { in: ["OPEN", "AWAITING_VENDOR", "UNDER_REVIEW"] as never } } };
  const stateWhere: Record<string, Prisma.VendorOrderWhereInput> = {
    awaiting_delivery: { status: { in: ["NEW", "PROCESSING", "READY_FOR_DISPATCH", "SHIPPED"] } },
    in_hold: { status: "DELIVERED", settledAt: null, disputes: { none: openDispute.some } },
    blocked: { settledAt: null, disputes: openDispute },
    settled: { settledAt: { not: null } },
  };
  const where: Prisma.VendorOrderWhereInput = {
    status: { notIn: ["AWAITING_PAYMENT", "CANCELLED"] },
    ...(sp.state && stateWhere[sp.state] ? stateWhere[sp.state] : {}),
    ...(sp.currency ? { settlementCurrency: sp.currency } : {}),
    ...(sp.vendor ? { vendorId: sp.vendor } : {}),
    ...(sp.q ? { number: { contains: sp.q.toUpperCase() } } : {}),
  };
  const [rows, total, agg, vendors] = await Promise.all([
    db.vendorOrder.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { vendor: { select: { businessName: true, country: true } }, disputes: { select: { status: true } } } }),
    db.vendorOrder.count({ where }),
    Promise.all(Object.entries(stateWhere).map(async ([k, w]) => [k, await db.vendorOrder.aggregate({ where: { ...w, status: (w.status as never) ?? { notIn: ["AWAITING_PAYMENT", "CANCELLED"] } }, _sum: { vendorNetMinor: true }, _count: true })] as const)),
    db.vendor.findMany({ where: { status: "APPROVED" }, select: { id: true, businessName: true }, orderBy: { businessName: "asc" } }),
  ]);
  const a = Object.fromEntries(agg);
  const eligibleOn = (d: Date | null, evidence: string | null) => (d ? new Date(d.getTime() + (STRONG_EVIDENCE.includes(evidence ?? "") ? hold : Math.max(hold, claimHold)) * 864e5) : null);
  return (
    <>
      <PageHeader title="Settlements" description={`Vendor earnings move from pending to available ${hold} days after verified delivery (carrier, rider proof, customer confirmation, digital, service). A vendor-only claim waits ${claimHold} days. Open disputes block release.`} actions={<>
        <ButtonLink variant="secondary" href={qs("/admin-export/settlements", { ...sp, page: undefined })}>Export CSV</ButtonLink>
        {u.permissions.has("finance.payout.approve") && <form action={runSettlementAction}><SubmitButton variant="secondary">Run settlement now</SubmitButton></form>}
      </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Awaiting delivery" value={formatMoney(a.awaiting_delivery?._sum.vendorNetMinor ?? 0n)} sub={`${a.awaiting_delivery?._count ?? 0} sub-orders`} />
        <Kpi label="In hold window" value={formatMoney(a.in_hold?._sum.vendorNetMinor ?? 0n)} sub={`${a.in_hold?._count ?? 0} sub-orders`} />
        <Kpi label="Blocked by dispute" value={formatMoney(a.blocked?._sum.vendorNetMinor ?? 0n)} sub={`${a.blocked?._count ?? 0} sub-orders`} tone={(a.blocked?._count ?? 0) > 0 ? "warning" : undefined} />
        <Kpi label="Settled" value={formatMoney(a.settled?._sum.vendorNetMinor ?? 0n)} sub={`${a.settled?._count ?? 0} sub-orders`} tone="success" />
      </div>
      <FilterBar action="/admin/settlements" values={sp} fields={[
        { type: "search", name: "q", placeholder: "Sub-order number" },
        { type: "select", name: "state", label: "Settlement state", options: [["awaiting_delivery", "Awaiting delivery"], ["in_hold", "In hold window"], ["blocked", "Blocked by dispute"], ["settled", "Settled"]] },
        { type: "select", name: "currency", label: "Settlement currency", options: [["NGN", "NGN"], ["CNY", "CNY"], ["USD", "USD"], ["GBP", "GBP"]] },
        { type: "select", name: "vendor", label: "Vendor", options: vendors.map((v) => [v.id, v.businessName]) },
      ]} />
      <Table>
        <thead><tr><Th>Sub-order</Th><Th>Vendor</Th><Th>Fulfilment</Th><Th>Delivery evidence</Th><Th>Eligible from</Th><Th>Settles in</Th><Th className="text-right">Commission</Th><Th className="text-right">Vendor net</Th><Th>Settlement</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={9} className="py-8 text-center text-ink-muted">No sub-orders match.</Td></tr>}
          {rows.map((v) => {
            const blocked = v.disputes.some((d) => ["OPEN", "AWAITING_VENDOR", "UNDER_REVIEW"].includes(d.status));
            const el = eligibleOn(v.deliveredAt, v.deliveryEvidence);
            return (
              <tr key={v.id} className="hover:bg-canvas">
                <Td><Link href={`/admin/orders/${v.number.split("-").slice(0, 2).join("-")}`} className="font-medium text-ink hover:text-brand">{v.number}</Link></Td>
                <Td>{v.vendor.businessName} <span className="text-ink-muted">({v.vendor.country})</span></Td>
                <Td><StatusBadge status={v.status} /></Td>
                <Td>{v.deliveryEvidence ? <Badge tone={STRONG_EVIDENCE.includes(v.deliveryEvidence) ? "success" : "warning"}>{v.deliveryEvidence.toLowerCase().replace(/_/g, " ")}</Badge> : "—"}</Td>
                <Td>{v.settledAt ? "—" : el ? el.toLocaleDateString("en-NG", { dateStyle: "medium" }) : "After delivery"}</Td>
                <Td>{v.settlementCurrency}</Td>
                <Td className="tabular text-right">{formatMoney(v.commissionMinor)}</Td>
                <Td className="tabular text-right font-medium">{formatMoney(v.vendorNetMinor)}</Td>
                <Td>{blocked ? <Badge tone="danger">Blocked — dispute</Badge> : v.settledAt ? <Badge tone="success">Settled {v.settledAt.toLocaleDateString("en-NG")}</Badge> : v.status === "REFUNDED" ? <Badge>Refunded</Badge> : <Badge tone="warning">Pending</Badge>}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(n) => qs("/admin/settlements", { ...sp, page: n })} />
    </>
  );
}
