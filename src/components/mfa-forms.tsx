"use client";
import { useActionState } from "react";
import { confirmEnrollmentAction, verifyMfaAction } from "@/app/actions/mfa";
import { Field, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";

export function EnrollForm() {
  const [s, action] = useActionState(confirmEnrollmentAction, null);
  if (s?.ok) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Two-step verification is on" />
        <p className="text-sm text-ink-2">Store these one-time recovery codes somewhere safe. Each works once if you lose your phone. They won't be shown again.</p>
        <pre className="tabular rounded-md border border-line bg-canvas p-4 text-sm leading-7">{s.message?.split(" ").join("\n")}</pre>
        <ButtonLink href="/admin">Continue to admin</ButtonLink>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      {s?.message && <Alert tone="danger">{s.message}</Alert>}
      <Field label="6-digit code from your app" htmlFor="code"><Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="tabular max-w-40 tracking-widest" /></Field>
      <SubmitButton>Turn on two-step verification</SubmitButton>
    </form>
  );
}

export function VerifyForm() {
  const [s, action] = useActionState(verifyMfaAction, null);
  return (
    <form action={action} className="space-y-4">
      {s?.message && <Alert tone="danger">{s.message}</Alert>}
      <Field label="Authenticator code or recovery code" htmlFor="code"><Input id="code" name="code" autoComplete="one-time-code" maxLength={10} required autoFocus className="tabular max-w-52 tracking-widest" /></Field>
      <SubmitButton>Verify</SubmitButton>
    </form>
  );
}
