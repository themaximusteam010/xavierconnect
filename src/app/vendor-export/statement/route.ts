import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { hasVendorCapability } from "@/server/auth/rbac";
import { resolveRange } from "@/components/admin/date-range";
import { toCsv, minorToDecimal } from "@/lib/csv";

/** Vendor statement: ledger movements on the vendor's own accounts only (tenant-scoped). */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  const vendorId = u?.vendorIds[0];
  if (!u || !vendorId || !hasVendorCapability(u.grants, vendorId, "finance")) return new NextResponse("Forbidden", { status: 403 });
  const r = resolveRange(Object.fromEntries(new URL(req.url).searchParams), "90d");
  const entries = await db.ledgerEntry.findMany({ where: { account: { vendorId }, createdAt: { gte: r.from, lt: r.to } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50_000, include: { account: { select: { code: true, currency: true } }, transaction: { select: { kind: true, reference: true, description: true } } } });
  const csv = toCsv(["date", "type", "reference", "description", "balance", "currency", "credit", "debit"], entries.map((e) => [e.createdAt, e.transaction.kind, e.transaction.reference, e.transaction.description, e.account.code.split(":").pop(), e.account.currency, minorToDecimal(e.creditMinor), minorToDecimal(e.debitMinor)]));
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="statement-${r.from.toISOString().slice(0, 10)}_${r.to.toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" } });
}
