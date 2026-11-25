"use client";
import Link from "next/link";
import { useActionState } from "react";
import { forgotPasswordAction, loginAction, registerAction, resendVerificationAction, resetPasswordAction } from "@/app/actions/auth";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/feedback";

export function LoginForm({ next }: { next?: string }) {
  const [s, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4" noValidate>
      {s?.message && <Alert tone="danger">{s.message}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email" error={s?.errors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" defaultValue={s?.values?.email} required aria-invalid={!!s?.errors?.email} />
      </Field>
      <Field label="Password" htmlFor="password" error={s?.errors?.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <div className="flex justify-end"><Link href="/forgot-password" className="text-[13px] text-brand hover:underline">Forgot password?</Link></div>
      <SubmitButton className="w-full" pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}

export function RegisterForm({ next }: { next?: string }) {
  const [s, action] = useActionState(registerAction, null);
  return (
    <form action={action} className="space-y-4" noValidate>
      {s?.message && <Alert tone="danger">{s.message}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Full name" htmlFor="name" error={s?.errors?.name}>
        <Input id="name" name="name" autoComplete="name" defaultValue={s?.values?.name} required aria-invalid={!!s?.errors?.name} />
      </Field>
      <Field label="Email" htmlFor="email" error={s?.errors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" defaultValue={s?.values?.email} required aria-invalid={!!s?.errors?.email} />
      </Field>
      <Field label="Password" htmlFor="password" error={s?.errors?.password} hint="At least 10 characters, with letters and a number.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={!!s?.errors?.password} />
      </Field>
      <Checkbox name="terms" label={<>I agree to the <Link href="/legal/terms" className="text-brand underline">Terms</Link> and <Link href="/legal/privacy" className="text-brand underline">Privacy Policy</Link>.</>} />
      {s?.errors?.terms && <p className="text-[13px] text-danger">{s.errors.terms[0]}</p>}
      <SubmitButton className="w-full" pendingLabel="Creating account…">Create account</SubmitButton>
    </form>
  );
}

export function ForgotForm() {
  const [s, action] = useActionState(forgotPasswordAction, null);
  if (s?.ok) return <Alert tone="success">{s.message}</Alert>;
  return (
    <form action={action} className="space-y-4" noValidate>
      {s?.message && <Alert tone="danger">{s.message}</Alert>}
      <Field label="Email" htmlFor="email" error={s?.errors?.email}><Input id="email" name="email" type="email" required /></Field>
      <SubmitButton className="w-full">Send reset link</SubmitButton>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [s, action] = useActionState(resetPasswordAction, null);
  return (
    <form action={action} className="space-y-4" noValidate>
      {s?.message && <Alert tone="danger">{s.message}</Alert>}
      <input type="hidden" name="token" value={token} />
      <Field label="New password" htmlFor="password" error={s?.errors?.password} hint="At least 10 characters, with letters and a number.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton className="w-full">Set new password</SubmitButton>
    </form>
  );
}

export function ResendVerification() {
  const [s, action] = useActionState(resendVerificationAction, null);
  return (
    <form action={action} className="space-y-3">
      {s?.message && <Alert tone={s.ok ? "success" : "danger"}>{s.message}</Alert>}
      <SubmitButton variant="secondary" className="w-full">Resend verification email</SubmitButton>
    </form>
  );
}
