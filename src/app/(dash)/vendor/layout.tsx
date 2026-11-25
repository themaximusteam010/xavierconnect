import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { hasVendorCapability } from "@/server/auth/rbac";
import { DashShell } from "@/components/layout/dash-shell";

export const dynamic = "force-dynamic";

export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser("/vendor");
  const vendorId = u.vendorIds[0];
  if (!vendorId) redirect("/sell/apply");
  const vendor = await db.vendor.findUniqueOrThrow({ where: { id: vendorId }, include: { store: true } });
  const [newOrders, pendingBookings] = await Promise.all([
    db.vendorOrder.count({ where: { vendorId, status: "NEW" } }),
    db.booking.count({ where: { vendorId, status: "REQUESTED" } }),
  ]);
  const can = (c: Parameters<typeof hasVendorCapability>[2]) => hasVendorCapability(u.grants, vendorId, c);
  const nav = [
    { href: "/vendor", label: "Overview" },
    can("catalog") && { href: "/vendor/products", label: "Products" },
    can("orders") && { href: "/vendor/orders", label: "Orders", badge: newOrders },
    can("services") && { href: "/vendor/services", label: "Services" },
    can("services") && { href: "/vendor/bookings", label: "Bookings", badge: pendingBookings },
    can("finance") && { href: "/vendor/earnings", label: "Earnings" },
    can("catalog") && { href: "/vendor/marketing", label: "Coupons" },
    can("settings") && { href: "/vendor/settings", label: "Settings" },
  ].filter(Boolean) as { href: string; label: string; badge?: number }[];
  return (
    <DashShell title={vendor.store?.name ?? vendor.businessName} subtitle={vendor.status === "APPROVED" ? "Seller dashboard" : `Application ${vendor.status.toLowerCase().replace("_", " ")}`} nav={nav} viewHref={vendor.store && vendor.status === "APPROVED" ? `/store/${vendor.store.slug}` : undefined}>
      {vendor.status === "SUSPENDED" && <div className="mb-6 rounded-md border border-red-200 bg-danger-soft px-4 py-3 text-sm text-danger">Your store is suspended and hidden from buyers. Reason: {vendor.reviewNote ?? "contact support"}.</div>}
      {children}
    </DashShell>
  );
}
