import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { DashShell } from "@/components/layout/dash-shell";
import type { Permission } from "@/server/auth/rbac";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser("/admin");
  if (!u.permissions.has("admin.access")) redirect("/account");
  const has = (p: Permission) => u.permissions.has(p);
  const [apps, listings, payouts, tickets] = await Promise.all([
    has("vendor.view") ? db.vendor.count({ where: { status: "SUBMITTED" } }) : 0,
    has("listing.moderate") ? Promise.all([db.product.count({ where: { status: "PENDING_REVIEW", deletedAt: null } }), db.service.count({ where: { status: "PENDING_REVIEW" } })]).then(([a, b]) => a + b) : 0,
    has("finance.view") ? db.payout.count({ where: { status: "REQUESTED" } }) : 0,
    has("support.view") ? db.supportTicket.count({ where: { status: { in: ["OPEN", "ESCALATED"] } } }) : 0,
  ]);
  const nav = [
    { href: "/admin", label: "Overview", p: "admin.access" },
    { href: "/admin/vendors", label: "Vendors", p: "vendor.view", badge: apps },
    { href: "/admin/listings", label: "Listings", p: "listing.moderate", badge: listings },
    { href: "/admin/orders", label: "Orders", p: "order.view_all" },
    { href: "/admin/finance", label: "Finance", p: "finance.view", badge: payouts },
    { href: "/admin/users", label: "Users & staff", p: "user.view" },
    { href: "/admin/support", label: "Support", p: "support.view", badge: tickets },
    { href: "/admin/content", label: "Content", p: "cms.manage" },
    { href: "/admin/audit", label: "Audit log", p: "audit.view" },
  ].filter((n) => has(n.p as Permission));
  return <DashShell title="XavierConnect Admin" subtitle={u.grants.filter((g) => !g.vendorId && g.role !== "CUSTOMER").map((g) => g.role.replace(/_/g, " ").toLowerCase()).join(", ")} nav={nav}>{children}</DashShell>;
}
