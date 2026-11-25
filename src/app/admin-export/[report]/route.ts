import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser, mfaRequired } from "@/server/auth/session";
import type { Permission } from "@/server/auth/rbac";
import { audit } from "@/server/services/audit";
import { resolveRange } from "@/components/admin/date-range";
import { toCsv, minorToDecimal, type Cell } from "@/lib/csv";

const MAX_ROWS = 50_000;
const REPORTS: Record<string, Permission> = { payments: "finance.view", payouts: "finance.view", settlements: "finance.view", ledger: "finance.view", orders: "order.view_all", shipments: "order.view_all" };

/** Staff CSV exports. Same permission as the page, MFA enforced, every export audit-logged. */
export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const perm = REPORTS[report];
  if (!perm) return new NextResponse("Not found", { status: 404 });
  const u = await getCurrentUser();
  if (!u?.permissions.has(perm)) return new NextResponse("Forbidden", { status: 403 });
  if (mfaRequired() && !u.mfaVerified) return new NextResponse("Two-step verification required", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams) as Record<string, string | undefined>;
  const r = resolveRange(sp);
  const created = { gte: r.from, lt: r.to };
  let header: string[] = [];
  let rows: Cell[][] = [];
  const m = (x: bigint | null | undefined) => (x == null ? "" : minorToDecimal(x));

  if (report === "payments") {
    const list = await db.payment.findMany({ where: { createdAt: created, ...(sp.status ? { status: sp.status as never } : {}), ...(sp.provider ? { provider: sp.provider } : {}) }, orderBy: { createdAt: "asc" }, take: MAX_ROWS, include: { order: { select: { number: true } } } });
    header = ["created_at", "reference", "order", "provider", "channel", "status", "currency", "amount", "fees", "verified_at", "failure_reason"];
    rows = list.map((p) => [p.createdAt, p.reference, p.order.number, p.provider, p.channel, p.status, p.currency, m(p.amountMinor), m(p.feesMinor), p.verifiedAt, p.failureReason]);
  } else if (report === "payouts") {
    const list = await db.payout.findMany({ where: { createdAt: created, ...(sp.status ? { status: sp.status as never } : {}), ...(sp.provider ? { providerKey: sp.provider } : {}) }, orderBy: { createdAt: "asc" }, take: MAX_ROWS, include: { vendor: { select: { businessName: true, country: true } } } });
    header = ["created_at", "payout_id", "vendor", "vendor_country", "status", "method", "provider", "currency", "amount", "settlement_currency", "settlement_amount", "fx_rate", "provider_fee", "provider_ref", "paid_at", "failure_reason"];
    rows = list.map((p) => [p.createdAt, p.id, p.vendor.businessName, p.vendor.country, p.status, p.method, p.providerKey, p.currency, m(p.amountMinor), p.settlementCurrency, m(p.settlementAmountMinor), p.fxRate?.toString(), m(p.providerFeeMinor), p.providerRef, p.paidAt, p.failureReason]);
  } else if (report === "settlements" || report === "orders") {
    const where = report === "settlements" ? { settledAt: created } : { createdAt: created, ...(sp.status ? { status: sp.status as never } : {}) };
    const list = await db.vendorOrder.findMany({ where, orderBy: { createdAt: "asc" }, take: MAX_ROWS, include: { vendor: { select: { businessName: true } }, order: { select: { number: true, paymentStatus: true } } } });
    header = ["created_at", "sub_order", "order", "vendor", "status", "payment_status", "subtotal", "discount", "shipping", "tax", "total", "commission", "vendor_net", "settlement_currency", "delivery_evidence", "delivered_at", "settled_at"];
    rows = list.map((v) => [v.createdAt, v.number, v.order.number, v.vendor.businessName, v.status, v.order.paymentStatus, m(v.subtotalMinor), m(v.discountMinor), m(v.shippingMinor), m(v.taxMinor), m(v.totalMinor), m(v.commissionMinor), m(v.vendorNetMinor), v.settlementCurrency, v.deliveryEvidence, v.deliveredAt, v.settledAt]);
  } else if (report === "shipments") {
    const list = await db.shipment.findMany({ where: { createdAt: created, ...(sp.status ? { status: sp.status as never } : {}) }, orderBy: { createdAt: "asc" }, take: MAX_ROWS, include: { vendorOrder: { select: { number: true } } } });
    header = ["created_at", "sub_order", "carrier", "provider", "tracking", "status", "origin", "destination", "international", "cost", "cost_currency", "shipped_at", "delivered_at"];
    rows = list.map((s) => [s.createdAt, s.vendorOrder.number, s.carrier, s.providerKey ?? "vendor", s.trackingNumber, s.status, s.originCountry, s.destinationCountry, s.international, m(s.costMinor), s.costCurrency, s.shippedAt, s.deliveredAt]);
  } else if (report === "ledger") {
    const list = await db.ledgerEntry.findMany({ where: { createdAt: created }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_ROWS, include: { transaction: true, account: { select: { code: true, currency: true } } } });
    header = ["created_at", "transaction_id", "kind", "reference", "description", "account", "currency", "debit", "credit"];
    rows = list.map((e) => [e.createdAt, e.transactionId, e.transaction.kind, e.transaction.reference, e.transaction.description, e.account.code, e.account.currency, m(e.debitMinor), m(e.creditMinor)]);
  }

  await audit(db, { actorId: u.id, action: "report.export", entityType: "Report", entityId: report, after: { from: r.from, to: r.to, rows: rows.length, filters: sp } });
  const name = `xavierconnect-${report}-${r.from.toISOString().slice(0, 10)}_${r.to.toISOString().slice(0, 10)}.csv`;
  return new NextResponse(toCsv(header, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store", ...(rows.length === MAX_ROWS ? { "X-Truncated": "true" } : {}) } });
}
