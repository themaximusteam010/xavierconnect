import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { signOutEverywhereAction, unlinkGoogleAction } from "@/app/actions/account";
import { googleEnabled } from "@/server/auth/google";
import { FlashFromQuery } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { PasswordForm, ProfileForm } from "@/components/account-forms";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Settings" };

export default async function Settings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser("/account/settings");
  const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, include: { externalIdentities: true } });
  const google = row.externalIdentities.find((i) => i.provider === "google");
  const sessions = await db.session.count({ where: { userId: u.id, expiresAt: { gt: new Date() } } });
  return (
    <>
      <PageHeader title="Settings" />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <section className="space-y-10">
        <div><h2 className="mb-4 font-semibold">Profile</h2><ProfileForm name={row.name} phone={row.phone ?? ""} /></div>
        <div><h2 className="mb-4 font-semibold">Password</h2>{row.passwordHash ? <PasswordForm /> : <p className="text-sm text-ink-muted">You sign in with Google and haven&apos;t set a password. To add one, use <a href="/forgot-password" className="text-brand underline">Forgot password</a> — we&apos;ll email you a link.</p>}</div>
        <div>
          <h2 className="mb-1 font-semibold">Connected accounts</h2>
          {google ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4 text-sm">
              <span>Google · {google.email} <span className="text-ink-muted">· connected {google.linkedAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</span></span>
              <form action={unlinkGoogleAction}><Button type="submit" variant="secondary" size="sm">Disconnect</Button></form>
            </div>
          ) : googleEnabled() ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4 text-sm">
              <span className="text-ink-muted">Sign in faster with your Google account.</span>
              <a href="/auth/google/start?link=1" className="inline-flex h-9 items-center rounded-md border border-line-strong px-3 font-medium hover:bg-sunken">Connect Google</a>
            </div>
          ) : <p className="text-sm text-ink-muted">Google sign-in isn&apos;t available yet.</p>}
        </div>
        <div>
          <h2 className="mb-1 font-semibold">Sessions</h2>
          <p className="mb-4 text-sm text-ink-muted">You are signed in on {sessions} {sessions === 1 ? "device" : "devices"}.</p>
          <form action={signOutEverywhereAction}><Button type="submit" variant="secondary">Sign out of all devices</Button></form>
        </div>
      </section>
    </>
  );
}
