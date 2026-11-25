import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { mfaRequired, requireUser } from "@/server/auth/session";
import { DashShell } from "@/components/layout/dash-shell";
import type { Permission } from "@/server/auth/rbac";
import { ADMIN_NAV } from "@/components/admin/nav";

export const dynamic = "force-dynamic";



export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser("/admin");
  if (!u.permissions.has("admin.access")) redirect("/account");
  if (mfaRequired() && !(u.mfaEnabled && u.mfaVerified)) redirect("/mfa");
  const has = (p: Permission) => u.permissions.has(p);
  const [apps, listings, payouts, tickets, disputes, alerts] = await Promise.all([
    has("vendor.view") ? db.vendor.count({ where: { status: "SUBMITTED" } }) : 0,
    has("listing.moderate") ? Promise.all([db.product.count({ where: { status: "PENDING_REVIEW", deletedAt: null } }), db.service.count({ where: { status: "PENDING_REVIEW" } })]).then(([a, b]) => a + b) : 0,
    has("finance.view") ? db.payout.count({ where: { status: "REQUESTED" } }) : 0,
    has("support.view") ? db.supportTicket.count({ where: { status: { in: ["OPEN", "ESCALATED"] } } }) : 0,
    has("dispute.decide") ? db.dispute.count({ where: { status: { in: ["OPEN", "AWAITING_VENDOR", "UNDER_REVIEW"] } } }) : 0,
    has("integrations.view") ? db.adminAlert.count({ where: { resolvedAt: null, severity: { in: ["WARNING", "CRITICAL"] } } }) : 0,
  ]);
  const badges: Record<string, number> = { "/admin/vendor-verification": apps, "/admin/products": listings, "/admin/payouts": payouts, "/admin/support": tickets, "/admin/disputes": disputes, "/admin/integrations": alerts };
  const nav = ADMIN_NAV.filter((n) => has(n.p)).map((n) => ({ ...n, badge: badges[n.href] }));
  return <DashShell title="XavierConnect Back Office" subtitle={u.grants.filter((g) => !g.vendorId && g.role !== "CUSTOMER").map((g) => g.role.replace(/_/g, " ").toLowerCase()).join(", ")} nav={nav}>{children}</DashShell>;
}
