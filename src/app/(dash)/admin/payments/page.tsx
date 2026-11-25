import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { resolveRange } from "@/components/admin/date-range";
import { FilterBar, qs } from "@/components/admin/filters";
import { Kpi } from "@/components/admin/charts";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { ButtonLink } from "@/components/ui/button";
import { formatMoney, parseNairaToMinor } from "@/lib/money";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Payments" };
type SP = { q?: string; status?: string; provider?: string; currency?: string; range?: string; from?: string; to?: string; min?: string; page?: string; vendor?: string };

export default async function Payments({ searchParams }: { searchParams: Promise<SP> }) {
  await guard("finance.view");
  const sp = await searchParams;
  const r = resolveRange(sp, "90d");
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.PaymentWhereInput = {
    createdAt: { gte: r.from, lt: r.to },
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(sp.provider ? { provider: sp.provider } : {}),
    ...(sp.currency ? { currency: sp.currency } : {}),
    ...(sp.q ? { OR: [{ reference: { contains: sp.q } }, { order: { number: { contains: sp.q.toUpperCase() } } }] } : {}),
    ...(sp.min && parseNairaToMinor(sp.min) ? { amountMinor: { gte: parseNairaToMinor(sp.min)! } } : {}),
    ...(sp.vendor ? { order: { vendorOrders: { some: { vendorId: sp.vendor } } } } : {}),
  };
  const [rows, total, sums, providers, vendors] = await Promise.all([
    db.payment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { order: { include: { vendorOrders: { select: { number: true, commissionMinor: true, vendor: { select: { businessName: true, country: true } } } }, refunds: { select: { amountMinor: true, status: true } } } } } }),
    db.payment.count({ where }),
    db.payment.groupBy({ by: ["status"], where, _sum: { amountMinor: true, feesMinor: true }, _count: true }),
    db.payment.findMany({ distinct: ["provider"], select: { provider: true } }),
    db.vendor.findMany({ where: { status: "APPROVED" }, select: { id: true, businessName: true }, orderBy: { businessName: "asc" } }),
  ]);
  const s = (st: string) => sums.find((x) => x.status === st);
  return (
    <>
      <PageHeader title="Payments" description={`${r.label} · customer transactions across all providers`} actions={<ButtonLink variant="secondary" href={qs("/admin-export/payments", { ...sp, page: undefined })}>Export CSV</ButtonLink>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Succeeded" value={formatMoney(s("SUCCEEDED")?._sum.amountMinor ?? 0n)} sub={`${s("SUCCEEDED")?._count ?? 0} payments · fees ${formatMoney(s("SUCCEEDED")?._sum.feesMinor ?? 0n)}`} tone="success" />
        <Kpi label="Pending" value={s("INITIATED")?._count ?? 0} sub={formatMoney(s("INITIATED")?._sum.amountMinor ?? 0n)} />
        <Kpi label="Failed" value={s("FAILED")?._count ?? 0} tone={(s("FAILED")?._count ?? 0) > 0 ? "danger" : undefined} />
        <Kpi label="Abandoned" value={s("ABANDONED")?._count ?? 0} />
      </div>
      <FilterBar action="/admin/payments" values={sp} fields={[
        { type: "search", name: "q", placeholder: "Reference or order number" },
        { type: "select", name: "status", label: "Status", options: [["SUCCEEDED", "Succeeded"], ["INITIATED", "Pending"], ["FAILED", "Failed"], ["ABANDONED", "Abandoned"]] },
        { type: "select", name: "provider", label: "Provider", options: providers.map((p) => [p.provider, p.provider]) },
        { type: "select", name: "currency", label: "Currency", options: [["NGN", "NGN"]] },
        { type: "select", name: "vendor", label: "Vendor", options: vendors.map((v) => [v.id, v.businessName]) },
        { type: "search", name: "min", placeholder: "Min amount (₦)" },
        { type: "range" },
      ]} />
      <Table>
        <thead><tr><Th>Reference</Th><Th>Order</Th><Th>Vendors / sub-orders</Th><Th>Provider</Th><Th>Status</Th><Th className="text-right">Commission</Th><Th className="text-right">Refunded</Th><Th className="text-right">Amount</Th><Th>Date</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={9} className="py-8 text-center text-ink-muted">No payments match these filters.</Td></tr>}
          {rows.map((p) => {
            const refunded = p.order.refunds.filter((x) => x.status === "COMPLETED" || x.status === "PROCESSING").reduce((a, x) => a + x.amountMinor, 0n);
            return (
              <tr key={p.id} className="hover:bg-canvas">
                <Td><Link href={`/admin/payments/${p.id}`} className="font-mono text-[12px] text-ink hover:text-brand">{p.reference}</Link></Td>
                <Td><Link href={`/admin/orders/${p.order.number}`} className="hover:text-brand">{p.order.number}</Link></Td>
                <Td className="max-w-64"><span className="line-clamp-2 text-[12px]">{p.order.vendorOrders.map((v) => `${v.number} · ${v.vendor.businessName} (${v.vendor.country})`).join(", ")}</span></Td>
                <Td>{p.provider}</Td>
                <Td><StatusBadge status={p.status} />{p.failureReason && <span className="block max-w-40 truncate text-[11px] text-danger">{p.failureReason}</span>}</Td>
                <Td className="tabular text-right">{formatMoney(p.order.vendorOrders.reduce((a, v) => a + v.commissionMinor, 0n))}</Td>
                <Td className="tabular text-right">{refunded > 0n ? formatMoney(refunded) : "—"}</Td>
                <Td className="tabular text-right font-medium">{formatMoney(p.amountMinor)} <span className="text-[11px] text-ink-muted">{p.currency}</span></Td>
                <Td className="whitespace-nowrap">{p.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(n) => qs("/admin/payments", { ...sp, page: n })} />
    </>
  );
}
