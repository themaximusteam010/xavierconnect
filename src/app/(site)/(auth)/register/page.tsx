import Link from "next/link";
import { RegisterForm } from "@/components/auth-forms";
import { GoogleButton } from "@/components/google-button";
import { googleEnabled } from "@/server/auth/google";

export const metadata = { title: "Create an account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <p className="mb-6 mt-1 text-sm text-ink-muted">One account to shop, book services and sell. Already registered? <Link href="/login" className="text-brand hover:underline">Sign in</Link></p>
      {googleEnabled() && <GoogleButton next={next} label="Sign up with Google" />}
      <RegisterForm next={next} />
    </>
  );
}
