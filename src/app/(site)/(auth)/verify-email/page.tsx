import { MailCheck } from "lucide-react";
import { verifyEmailToken } from "@/app/actions/auth";
import { getCurrentUser } from "@/server/auth/session";
import { ResendVerification } from "@/components/auth-forms";
import { Alert } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "Verify your email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string; next?: string; sent?: string }> }) {
  const sp = await searchParams;
  if (sp.token) {
    const ok = await verifyEmailToken(sp.token);
    return ok ? (
      <div className="space-y-5">
        <Alert tone="success" title="Email confirmed">Your account is fully set up.</Alert>
        <div className="flex gap-2"><ButtonLink href="/shop">Start shopping</ButtonLink><ButtonLink href="/sell" variant="secondary">Start selling</ButtonLink></div>
      </div>
    ) : (
      <div className="space-y-5">
        <Alert tone="danger" title="This link has expired or was already used" />
        <ResendVerification />
      </div>
    );
  }
  const user = await getCurrentUser();
  return (
    <div className="space-y-5">
      <MailCheck className="size-8 text-brand" aria-hidden />
      <h1 className="text-2xl font-semibold">Check your inbox</h1>
      <p className="text-sm text-ink-muted">We sent a confirmation link to <span className="font-medium text-ink">{user?.email ?? "your email"}</span>. You can keep shopping meanwhile — you will need a verified email to sell.</p>
      {user && !user.emailVerified && <ResendVerification />}
      <ButtonLink href={sp.next ?? "/"} variant="ghost">Continue</ButtonLink>
    </div>
  );
}
