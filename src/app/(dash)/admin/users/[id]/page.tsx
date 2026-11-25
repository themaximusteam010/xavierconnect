import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { ROLES } from "@/server/auth/rbac";
import { setUserRoleAction, setUserStatusAction } from "@/app/actions/admin";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";

export default async function UserDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const me = await guard("user.view");
  const { id } = await params;
  const sp = await searchParams;
  const u = await db.user.findUnique({ where: { id }, include: { roles: { include: { role: true, vendor: { include: { store: true } } } }, orders: { orderBy: { createdAt: "desc" }, take: 10 } } });
  if (!u) notFound();
  const activity = await db.auditLog.findMany({ where: { OR: [{ actorId: id }, { entityType: "User", entityId: id }] }, orderBy: { createdAt: "desc" }, take: 25 });
  const held = new Set(u.roles.filter((r) => !r.vendorId).map((r) => r.role.key));
  return (
    <>
      <PageHeader eyebrow="User" title={u.name} description={<span className="flex items-center gap-2"><StatusBadge status={u.status} /> {u.email} · joined {u.createdAt.toLocaleDateString("en-NG")}</span>} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-line bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold">Vendor memberships</h2>
            {u.roles.filter((r) => r.vendorId).length === 0 ? <p className="text-ink-muted">None.</p> : <ul>{u.roles.filter((r) => r.vendorId).map((r) => <li key={r.id}>{r.role.name} at <Link href={`/admin/vendors/${r.vendorId}`} className="text-brand underline">{r.vendor?.store?.name ?? r.vendor?.businessName}</Link></li>)}</ul>}
          </section>
          <section className="rounded-lg border border-line bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold">Recent orders</h2>
            {u.orders.length === 0 ? <p className="text-ink-muted">None.</p> : <ul className="space-y-1">{u.orders.map((o) => <li key={o.id} className="flex justify-between"><Link href={`/admin/orders/${o.number}`} className="text-brand">{o.number}</Link><StatusBadge status={o.status} /><span className="tabular">{formatMoney(o.totalMinor)}</span></li>)}</ul>}
          </section>
          <section className="rounded-lg border border-line bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold">Activity</h2>
            {activity.length === 0 ? <p className="text-ink-muted">No recorded activity.</p> : <ul className="space-y-1">{activity.map((a) => <li key={a.id}><span className="tabular text-ink-muted">{a.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</span> {a.action} {a.entityType} {a.actorId === id ? "(by this user)" : ""}</li>)}</ul>}
          </section>
        </div>
        <aside className="space-y-6">
          {me.permissions.has("user.manage") && (
            <form action={setUserStatusAction} className="rounded-lg border border-line bg-white p-4">
              <input type="hidden" name="id" value={u.id} />
              <h2 className="mb-3 font-semibold">Account status</h2>
              {u.status === "ACTIVE" ? <SubmitButton name="status" value="SUSPENDED" variant="danger" className="w-full" confirm="Suspend this account and sign them out everywhere?">Suspend account</SubmitButton> : <SubmitButton name="status" value="ACTIVE" className="w-full">Reactivate account</SubmitButton>}
            </form>
          )}
          <section className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-3 font-semibold">Platform roles</h2>
            <ul className="space-y-2 text-sm">
              {Object.entries(ROLES).filter(([, r]) => !r.vendorScoped).map(([key, r]) => (
                <li key={key} className="flex items-center justify-between gap-2">
                  <span className={held.has(key) ? "font-medium" : "text-ink-muted"}>{r.name}</span>
                  {me.permissions.has("staff.manage") ? (
                    <form action={setUserRoleAction}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="role" value={key} /><input type="hidden" name="grant" value={held.has(key) ? "0" : "1"} /><button className="text-[12px] text-brand">{held.has(key) ? "Remove" : "Grant"}</button></form>
                  ) : held.has(key) ? <span className="text-[12px]">✓</span> : null}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-ink-muted">Role changes are recorded in the audit log. Staff should enable MFA (planned) before receiving admin roles.</p>
          </section>
        </aside>
      </div>
    </>
  );
}
