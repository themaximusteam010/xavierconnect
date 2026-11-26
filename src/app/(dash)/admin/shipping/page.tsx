import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { shippingProviderName } from "@/server/services/shipping";
import { resolveRange } from "@/components/admin/date-range";
import { FilterBar } from "@/components/admin/filters";
import { HBars, Kpi, Panel } from "@/components/admin/charts";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { countryName } from "@/lib/countries";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Shipping & logistics" };

export default async function Shipping({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await guard("order.view_all");
  const sp = await searchParams;
  const r = resolveRange(sp);
  const inRange = { gte: r.from, lt: r.to };
  const [byStatus, byProvider, routes, perf, quotes, stale, methods, intl] = await Promise.all([
    db.shipment.groupBy({ by: ["status"], where: { createdAt: inRange }, _count: true }),
    db.shipment.groupBy({ by: ["providerKey"], where: { createdAt: inRange }, _count: true, _sum: { costMinor: true } }),
    db.$queryRaw<{ route: string; n: bigint }[]>`SELECT COALESCE("originCountry",'?') || '>' || COALESCE("destinationCountry",'NG') AS route, COUNT(*)::bigint n FROM "Shipment" WHERE "createdAt" >= ${r.from} AND "createdAt" < ${r.to} GROUP BY 1 ORDER BY n DESC`,
    db.$queryRaw<{ provider: string | null; days: number | null; n: bigint }[]>`SELECT "providerKey" AS provider, AVG(EXTRACT(EPOCH FROM ("deliveredAt" - COALESCE("shippedAt","createdAt"))) / 86400)::float AS days, COUNT(*)::bigint n FROM "Shipment" WHERE "deliveredAt" >= ${r.from} AND "deliveredAt" < ${r.to} GROUP BY 1`,
    db.shippingQuote.count({ where: { createdAt: inRange } }),
    db.shipment.count({ where: { status: { in: ["IN_TRANSIT", "PICKED_UP", "OUT_FOR_DELIVERY"] }, OR: [{ lastEventAt: { lt: new Date(Date.now() - 5 * 864e5) } }, { lastEventAt: null, createdAt: { lt: new Date(Date.now() - 5 * 864e5) } }] } }),
    db.shippingMethod.groupBy({ by: ["type"], where: { active: true }, _count: true }),
    db.vendor.count({ where: { internationalShipping: true, status: "APPROVED" } }),
  ]);
  const [charged, quotedMarkup, invoices, returns, failed] = await Promise.all([
    db.vendorOrder.aggregate({ where: { createdAt: inRange, order: { paymentStatus: "PAID" } }, _sum: { shippingMinor: true, shippingCostMinor: true }, _count: { shippingQuoteId: true } }),
    db.shippingQuote.aggregate({ where: { createdAt: inRange, vendorOrderId: { not: null } }, _sum: { markupMinor: true, costMinor: true } }),
    db.shippingInvoice.groupBy({ by: ["currency"], where: { issuedAt: inRange }, _sum: { amountMinor: true }, _count: true }),
    db.shippingReturn.groupBy({ by: ["status"], where: { createdAt: inRange }, _count: true }),
    db.shipment.count({ where: { createdAt: inRange, status: { in: ["FAILED_ATTEMPT", "RETURNED"] } } }),
  ]);
  const st = (s: string) => byStatus.find((x) => x.status === s)?._count ?? 0;
  const total = byStatus.reduce((a, x) => a + x._count, 0);
  return (
    <>
      <PageHeader title="Shipping & logistics" description={`${r.label} · vendor-managed and carrier-integrated deliveries`} actions={<><ButtonLink variant="secondary" href="/admin/shipments">All shipments</ButtonLink><ButtonLink variant="secondary" href="/admin/freight">Freight</ButtonLink><ButtonLink variant="secondary" href="/admin/integrations/shipping">Carriers</ButtonLink></>} />
      <FilterBar action="/admin/shipping" values={sp} fields={[{ type: "range" }]} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="Shipments" value={total} />
        <Kpi label="In transit" value={st("IN_TRANSIT") + st("PICKED_UP") + st("OUT_FOR_DELIVERY")} />
        <Kpi label="Delivered" value={st("DELIVERED")} tone="success" />
        <Kpi label="Exceptions" value={st("FAILED_ATTEMPT") + st("RETURNED")} tone={st("FAILED_ATTEMPT") + st("RETURNED") ? "warning" : undefined} />
        <Kpi label="No tracking for 5 days" value={stale} tone={stale ? "warning" : undefined} sub={<Link href="/admin/shipments?stale=1" className="text-brand">Review</Link>} />
        <Kpi label="Rate requests" value={quotes} sub={`${intl} vendors ship internationally`} />
      </div>
      <Panel title="Shipping finance (paid orders in period)" className="mb-6">
        <div className="grid grid-cols-2 gap-3 text-[13px] md:grid-cols-4">
          <div><p className="text-ink-muted">Shipping charged to customers</p><p className="tabular text-lg font-semibold">{formatMoney(charged._sum.shippingMinor ?? 0n)}</p></div>
          <div><p className="text-ink-muted">Carrier cost of labels bought</p><p className="tabular text-lg font-semibold">{formatMoney(charged._sum.shippingCostMinor ?? 0n)}</p><p className="text-[11px] text-ink-muted">NGN labels only</p></div>
          <div><p className="text-ink-muted">Markup on checkout courier quotes</p><p className="tabular text-lg font-semibold">{formatMoney(quotedMarkup._sum.markupMinor ?? 0n)}</p><p className="text-[11px] text-ink-muted">{charged._count.shippingQuoteId} sub-orders chose a courier at checkout</p></div>
          <div><p className="text-ink-muted">Provider invoices recorded</p>{invoices.length === 0 ? <p className="text-ink-muted">none</p> : invoices.map((i) => <p key={i.currency} className="tabular font-semibold">{i.currency === "NGN" ? formatMoney(i._sum.amountMinor ?? 0n) : `${i.currency} ${Number(i._sum.amountMinor ?? 0n) / 100}`} <span className="text-[11px] font-normal text-ink-muted">({i._count})</span></p>)}<Link href="/admin/freight?tab=invoices" className="text-[11px] text-brand">Freight invoices</Link></div>
          <div><p className="text-ink-muted">Failed / returned deliveries</p><p className="tabular text-lg font-semibold">{failed}</p></div>
          <div><p className="text-ink-muted">Customer returns</p><p className="text-[12px]">{returns.length === 0 ? "none" : returns.map((r) => `${r._count} ${r.status.toLowerCase()}`).join(" · ")}</p><Link href="/admin/shipments?tab=returns" className="text-[11px] text-brand">Returns queue</Link></div>
          <div><p className="text-ink-muted">Average label cost</p><p className="tabular text-lg font-semibold">{(() => { const n = byProvider.filter((p) => p.providerKey).reduce((a, p) => a + p._count, 0); const sum = byProvider.reduce((a, p) => a + (p._sum.costMinor ?? 0n), 0n); return n ? formatMoney(sum / BigInt(n)) : "—"; })()}</p></div>
          <div><p className="text-ink-muted">Reconciliation</p><p className="text-[12px]">Compare provider invoices with carrier cost above; differences are adjustments to raise with the provider.</p></div>
        </div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="By carrier"><HBars data={byProvider.map((p) => ({ label: shippingProviderName(p.providerKey), value: p._count }))} /></Panel>
        <Panel title="By route (origin → destination)"><HBars data={routes.map((x) => ({ label: x.route.split(">").map((c) => countryName(c)).join(" → "), value: Number(x.n) }))} /></Panel>
        <Panel title="Average days to deliver">
          {perf.length === 0 ? <p className="text-sm text-ink-muted">No deliveries in this period.</p> : <ul className="space-y-2 text-[13px]">{perf.map((p) => <li key={p.provider ?? "vendor"} className="flex justify-between"><span>{shippingProviderName(p.provider)}</span><span className="tabular font-medium">{(p.days ?? 0).toFixed(1)} days <span className="text-ink-muted">({Number(p.n)})</span></span></li>)}</ul>}
        </Panel>
        <Panel title="Carrier spend (labels bought)"><HBars data={byProvider.filter((p) => p.providerKey).map((p) => ({ label: shippingProviderName(p.providerKey), value: Number(p._sum.costMinor ?? 0n) }))} format={(n) => formatMoney(BigInt(n))} empty="No carrier labels bought in this period." /></Panel>
        <Panel title="Vendor delivery methods"><HBars data={methods.map((m) => ({ label: m.type.toLowerCase(), value: m._count }))} /></Panel>
      </div>
    </>
  );
}
