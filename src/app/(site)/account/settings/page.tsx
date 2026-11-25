import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { signOutEverywhereAction } from "@/app/actions/account";
import { PageHeader } from "@/components/ui/page-header";
import { PasswordForm, ProfileForm } from "@/components/account-forms";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const u = await requireUser("/account/settings");
  const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
  const sessions = await db.session.count({ where: { userId: u.id, expiresAt: { gt: new Date() } } });
  return (
    <>
      <PageHeader title="Settings" />
      <section className="space-y-10">
        <div><h2 className="mb-4 font-semibold">Profile</h2><ProfileForm name={row.name} phone={row.phone ?? ""} /></div>
        <div><h2 className="mb-4 font-semibold">Password</h2><PasswordForm /></div>
        <div>
          <h2 className="mb-1 font-semibold">Sessions</h2>
          <p className="mb-4 text-sm text-ink-muted">You are signed in on {sessions} {sessions === 1 ? "device" : "devices"}.</p>
          <form action={signOutEverywhereAction}><Button type="submit" variant="secondary">Sign out of all devices</Button></form>
        </div>
      </section>
    </>
  );
}
