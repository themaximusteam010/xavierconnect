"use client";
import { useActionState } from "react";
import { contactAction } from "@/app/actions/public";
import { Field, Input, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/feedback";

export function ContactForm() {
  const [s, action] = useActionState(contactAction, null);
  if (s?.ok) return <Alert tone="success">{s.message}</Alert>;
  return (
    <form action={action} className="space-y-4" noValidate>
      {s?.message && <Alert tone="danger">{s.message}</Alert>}
      <Field label="Your name" htmlFor="name" error={s?.errors?.name}><Input id="name" name="name" required /></Field>
      <Field label="Email" htmlFor="email" error={s?.errors?.email}><Input id="email" name="email" type="email" required /></Field>
      <Field label="How can we help?" htmlFor="message" error={s?.errors?.message}><Textarea id="message" name="message" rows={6} required /></Field>
      <SubmitButton>Send message</SubmitButton>
    </form>
  );
}
