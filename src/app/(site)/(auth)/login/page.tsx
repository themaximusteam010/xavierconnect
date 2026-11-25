import Link from "next/link";
import { LoginForm } from "@/components/auth-forms";
import { Alert } from "@/components/ui/feedback";
import { GoogleButton } from "@/components/google-button";
import { googleEnabled } from "@/server/auth/google";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-ink-muted">New to XavierConnect? <Link href={`/register${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`} className="text-brand hover:underline">Create an account</Link></p>
      {sp.error && <Alert tone="danger" className="mb-4">{sp.error}</Alert>}
      {googleEnabled() && <GoogleButton next={sp.next} />}
      {sp.reset && <Alert tone="success" className="mb-4">Your password was changed. Sign in with your new password.</Alert>}
      <LoginForm next={sp.next} />
      {googleEnabled() && <p className="mt-4 text-center text-[13px] text-ink-muted">Signed up with Google? Use “Continue with Google” above.</p>}
    </>
  );
}
