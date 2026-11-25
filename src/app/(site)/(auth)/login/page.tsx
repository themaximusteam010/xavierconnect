import Link from "next/link";
import { LoginForm } from "@/components/auth-forms";
import { Alert } from "@/components/ui/feedback";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-ink-muted">New to XavierConnect? <Link href={`/register${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`} className="text-brand hover:underline">Create an account</Link></p>
      {sp.reset && <Alert tone="success" className="mb-4">Your password was changed. Sign in with your new password.</Alert>}
      <LoginForm next={sp.next} />
    </>
  );
}
