import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { hasVendorCapability } from "@/server/auth/rbac";
import { minorToInput } from "@/lib/money";

const esc = (v: unknown) => {
  const s = String(v ?? "");
  // Prevent CSV formula injection in spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET() {
  const u = await getCurrentUser();
  const vendorId = u?.vendorIds[0];
  if (!u || !vendorId || !hasVendorCapability(u.grants, vendorId, "catalog")) return new NextResponse("Forbidden", { status: 403 });
  const rows = await db.product.findMany({ where: { vendorId, deletedAt: null }, orderBy: { createdAt: "asc" }, include: { category: true } });
  const header = ["id", "sku", "name", "type", "status", "category", "price_ngn", "sale_price_ngn", "stock", "brand", "tags", "url"];
  const lines = [header.join(",")].concat(rows.map((p) => [p.id, p.sku, p.name, p.type, p.status, p.category.slug, minorToInput(p.priceMinor), minorToInput(p.salePriceMinor), p.stockQuantity, p.brand, p.tags.join("|"), `/p/${p.slug}`].map(esc).join(",")));
  return new NextResponse(lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="products-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
