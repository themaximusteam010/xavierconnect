import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { grantStaffRoleByEmailAction, resetStaffMfaAction } from "@/app/actions/admin-ops";
import { ROLES } from "@/server/auth/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, Badge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata = { title: "Staff management" };

export default async function Staff({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const me = await guard("staff.manage");
  const sp = await searchParams;
  const staffKeys = Object.entries(ROLES).filter(([, r]) => r.staff).map(([k]) => k);
  const users = await db.user.findMany({
    where: { roles: { some: { role: { key: { in: staffKeys } }, vendorId: null } } },
    orderBy: { name: "asc" },
    include: { roles: { where: { vendorId: null }, include: { role: true } }, sessions: { where: { expiresAt: { gt: new Date() } }, select: { id: true } } },
  });
  return (
    <>
      <PageHeader title="Staff management" description="Every staff account must use two-step verification. Role changes and MFA resets are audit-logged." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Table>
          <thead><tr><Th>Name</Th><Th>Roles</Th><Th>Two-step</Th><Th>Last sign-in</Th><Th>Sessions</Th><Th /></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id}>
              <Td><Link href={`/admin/users/${u.id}`} className="font-medium text-ink hover:text-brand">{u.name}</Link><span className="block text-[12px] text-ink-muted">{u.email}</span></Td>
              <Td>{u.roles.filter((r) => ROLES[r.role.key]?.staff).map((r) => <Badge key={r.id} className="mr-1">{ROLES[r.role.key].name}</Badge>)}</Td>
              <Td>{u.mfaEnabledAt ? <Badge tone="success">on</Badge> : <Badge tone="danger">not enrolled</Badge>}</Td>
              <Td>{u.lastLoginAt?.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" }) ?? "—"}</Td>
              <Td className="tabular">{u.sessions.length}</Td>
              <Td>{u.id !== me.id && u.mfaEnabledAt && <form action={resetStaffMfaAction}><input type="hidden" name="id" value={u.id} /><SubmitButton size="sm" variant="ghost" confirm={`Reset two-step verification for ${u.name} and sign them out?`}>Reset MFA</SubmitButton></form>}</Td>
            </tr>
          ))}</tbody>
        </Table>
        <div className="space-y-4">
          <form action={grantStaffRoleByEmailAction} className="space-y-3 rounded-lg border border-line bg-white p-4 text-[13px]">
            <p className="font-semibold">Add a staff member</p>
            <p className="text-ink-muted">The person must already have a verified XavierConnect account.</p>
            <label className="block">Email<Input name="email" type="email" required /></label>
            <label className="block">Role<Select name="role">{staffKeys.map((k) => <option key={k} value={k}>{ROLES[k].name}</option>)}</Select></label>
            <SubmitButton size="sm">Grant role</SubmitButton>
          </form>
          <div className="rounded-lg border border-line bg-white p-4 text-[12px] text-ink-muted">
            <p className="mb-2 font-semibold text-ink">Role permissions</p>
            <ul className="space-y-1.5">{staffKeys.map((k) => <li key={k}><span className="font-medium text-ink">{ROLES[k].name}:</span> {ROLES[k].permissions.length} permissions</li>)}</ul>
            <p className="mt-2">To remove a role, open the person&apos;s account page.</p>
          </div>
        </div>
      </div>
    </>
  );
}
