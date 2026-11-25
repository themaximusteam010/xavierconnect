import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getEnrollmentSecret } from "@/app/actions/mfa";
import { otpauthUri } from "@/server/auth/totp";
import { Logo } from "@/components/brand/logo";
import { EnrollForm, VerifyForm } from "@/components/mfa-forms";

export const metadata = { title: "Two-step verification", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function MfaPage() {
  const u = await requireUser("/mfa");
  if (!u.isStaff) redirect("/account");
  if (u.mfaEnabled && u.mfaVerified) redirect("/admin");
  const secret = u.mfaEnabled ? null : await getEnrollmentSecret();
  return (
    <div className="flex min-h-dvh items-start justify-center bg-canvas px-4 py-16">
      <div className="w-full max-w-md rounded-lg border border-line bg-white p-8">
        <Logo />
        <div className="mt-8 flex items-center gap-2"><ShieldCheck className="size-5 text-brand" /><h1 className="text-xl font-semibold">{u.mfaEnabled ? "Confirm it's you" : "Set up two-step verification"}</h1></div>
        {u.mfaEnabled ? (
          <>
            <p className="mb-6 mt-2 text-sm text-ink-muted">Staff accounts need a second step every session. Enter the code from your authenticator app.</p>
            <VerifyForm />
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-muted">Staff accounts must use an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy).</p>
            <ol className="mb-6 mt-5 space-y-3 text-sm text-ink-2">
              <li>1. In your app, add an account and choose <b>enter a setup key</b>.</li>
              <li>2. Account: <span className="font-medium">{u.email}</span>, type: time-based. Key:
                <code className="tabular mt-2 block select-all break-all rounded-md border border-line bg-canvas px-3 py-2 text-[13px] tracking-wider">{secret?.match(/.{1,4}/g)?.join(" ")}</code>
              </li>
              <li>3. Enter the 6-digit code it shows.</li>
            </ol>
            <details className="mb-6 text-[12px] text-ink-muted"><summary className="cursor-pointer">Setup link for password managers</summary><code className="mt-2 block break-all">{otpauthUri(secret ?? "", u.email)}</code></details>
            <EnrollForm />
          </>
        )}
      </div>
    </div>
  );
}
