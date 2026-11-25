import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { resolveRange, dayBuckets } from "@/components/admin/date-range";
import { FilterBar, qs } from "@/components/admin/filters";
import { BarChart, HBars, Kpi, Panel } from "@/components/admin/charts";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { ButtonLink } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { countryName } from "@/lib/countries";

export const metadata = { title: "Reports & analytics" };
type Row = { k: string | null; gmv: bigint; commission: bigint; n: bigint };

/** All figures come from paid sub-orders in the database. Money is summed in SQL as bigint. */
export default async function Reports({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await guard("finance.view");
  const sp = await searchParams;
  const r = resolveRange(sp);
  const paid = `o."paymentStatus" IN ('PAID','PARTIALLY_REFUNDED') AND o."paidAt" >= $1 AND o."paidAt" < $2`;
  const q = (select: string, join = "", group = "1") =>
    db.$queryRawUnsafe<Row[]>(`SELECT ${select} AS k, COALESCE(SUM(vo."totalMinor"),0)::bigint gmv, COALESCE(SUM(vo."commissionMinor"),0)::bigint commission, COUNT(DISTINCT vo.id)::bigint n FROM "VendorOrder" vo JOIN "Order" o ON o.id = vo."orderId" ${join} WHERE ${paid} AND vo.status NOT IN ('CANCELLED','AWAITING_PAYMENT') GROUP BY ${group} ORDER BY gmv DESC LIMIT 15`, r.from, r.to);
  const [byVendor, byCountry, byCategory, daily, totals, refunds, customers] = await Promise.all([
    q(`v."businessName"`, `JOIN "Vendor" v ON v.id = vo."vendorId"`),
    q(`v.country`, `JOIN "Vendor" v ON v.id = vo."vendorId"`),
    db.$queryRawUnsafe<Row[]>(`SELECT c.name AS k, COALESCE(SUM(oi."lineTotalMinor" - oi."discountMinor"),0)::bigint gmv, COALESCE(SUM(oi."commissionMinor"),0)::bigint commission, COUNT(*)::bigint n FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" LEFT JOIN "Product" p ON p.id = oi."productId" LEFT JOIN "Category" c ON c.id = p."categoryId" WHERE ${paid} GROUP BY 1 ORDER BY gmv DESC LIMIT 15`, r.from, r.to),
    db.$queryRawUnsafe<{ d: Date; gmv: bigint }[]>(`SELECT date_trunc('day', o."paidAt" AT TIME ZONE 'Africa/Lagos') d, SUM(o."totalMinor")::bigint gmv FROM "Order" o WHERE ${paid} GROUP BY 1`, r.from, r.to),
    db.$queryRawUnsafe<{ gmv: bigint; commission: bigint; orders: bigint; aov: bigint }[]>(`SELECT COALESCE(SUM(vo."totalMinor"),0)::bigint gmv, COALESCE(SUM(vo."commissionMinor"),0)::bigint commission, COUNT(DISTINCT o.id)::bigint orders, CASE WHEN COUNT(DISTINCT o.id) = 0 THEN 0 ELSE (SUM(vo."totalMinor") / COUNT(DISTINCT o.id))::bigint END aov FROM "VendorOrder" vo JOIN "Order" o ON o.id = vo."orderId" WHERE ${paid} AND vo.status NOT IN ('CANCELLED','AWAITING_PAYMENT')`, r.from, r.to),
    db.refund.aggregate({ where: { createdAt: { gte: r.from, lt: r.to }, status: "COMPLETED" }, _sum: { amountMinor: true }, _count: true }),
    db.$queryRawUnsafe<{ n: bigint; repeat: bigint }[]>(`SELECT COUNT(*)::bigint n, COUNT(*) FILTER (WHERE c > 1)::bigint repeat FROM (SELECT o."userId", COUNT(*) c FROM "Order" o WHERE ${paid} AND o."userId" IS NOT NULL GROUP BY 1) t`, r.from, r.to),
  ]);
  const t = totals[0];
  const buckets = dayBuckets(r).map((b) => ({ label: b.label, value: Number(daily.find((d) => d.d.toISOString().slice(0, 10) === b.key)?.gmv ?? 0n) / 100 }));
  const money = (n: number) => formatMoney(BigInt(Math.round(n)));
  const exp = (name: string) => qs(`/admin-export/${name}`, { range: sp.range, from: sp.from, to: sp.to });
  const Breakdown = ({ rows, label, fmt = (k: string | null) => k ?? "Uncategorised" }: { rows: Row[]; label: string; fmt?: (k: string | null) => string }) => (
    <Table>
      <thead><tr><Th>{label}</Th><Th className="text-right">Sub-orders</Th><Th className="text-right">GMV</Th><Th className="text-right">Commission</Th></tr></thead>
      <tbody>{rows.length === 0 ? <tr><Td colSpan={4} className="py-6 text-center text-ink-muted">No paid orders in this period.</Td></tr> : rows.map((x) => <tr key={x.k ?? "none"}><Td>{fmt(x.k)}</Td><Td className="tabular text-right">{Number(x.n)}</Td><Td className="tabular text-right">{formatMoney(x.gmv)}</Td><Td className="tabular text-right">{formatMoney(x.commission)}</Td></tr>)}</tbody>
    </Table>
  );
  return (
    <>
      <PageHeader title="Reports & analytics" description={`${r.label} · paid orders only. Times in West Africa Time.`} />
      <FilterBar action="/admin/reports" values={sp} fields={[{ type: "range" }]} extra={<>{["orders", "payments", "settlements", "payouts", "shipments", "ledger"].map((x) => <ButtonLink key={x} size="sm" variant="secondary" href={exp(x)}>{x}.csv</ButtonLink>)}</>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="GMV" value={formatMoney(t?.gmv ?? 0n)} />
        <Kpi label="Commission earned" value={formatMoney(t?.commission ?? 0n)} />
        <Kpi label="Paid orders" value={Number(t?.orders ?? 0n)} />
        <Kpi label="Average order" value={formatMoney(t?.aov ?? 0n)} />
        <Kpi label="Refunded" value={formatMoney(refunds._sum?.amountMinor ?? 0n)} sub={`${refunds._count} refunds`} tone={refunds._count ? "warning" : undefined} />
        <Kpi label="Buying customers" value={Number(customers[0]?.n ?? 0n)} sub={`${Number(customers[0]?.repeat ?? 0n)} repeat`} />
      </div>
      <Panel title="GMV per day" className="mb-6"><BarChart data={buckets} label="GMV per day" format={(n) => money(n * 100)} /></Panel>
      <Alert className="mb-6">GMV is the value of paid sub-orders before refunds; commission is the platform fee booked to the ledger. These are operational figures, not audited accounts, and internal ledger balances are not safeguarded client funds.</Alert>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Top vendors"><Breakdown rows={byVendor} label="Vendor" /></Panel>
        <Panel title="By vendor country"><Breakdown rows={byCountry} label="Country" fmt={(k) => countryName(k ?? "NG")} /></Panel>
        <Panel title="By category (products)"><Breakdown rows={byCategory} label="Category" fmt={(k) => k ?? "Services / other"} /></Panel>
        <Panel title="Commission share by vendor"><HBars data={byVendor.map((v) => ({ label: v.k ?? "—", value: Number(v.commission) }))} format={(n) => formatMoney(BigInt(n))} /></Panel>
      </div>
    </>
  );
}
