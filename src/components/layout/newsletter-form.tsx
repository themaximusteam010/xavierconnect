"use client";
import { useActionState } from "react";
import { subscribeNewsletter } from "@/app/actions/public";
import { SubmitButton } from "@/components/ui/submit-button";

export function NewsletterForm() {
  const [state, action] = useActionState(subscribeNewsletter, null);
  if (state?.ok) return <p className="text-sm text-success">{state.message}</p>;
  return (
    <form action={action} className="flex gap-2">
      <label htmlFor="nl-email" className="sr-only">Email address</label>
      <input id="nl-email" name="email" type="email" required placeholder="you@example.com" className="h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-white px-3 text-sm focus:border-brand focus:outline-none" />
      <SubmitButton variant="secondary">Subscribe</SubmitButton>
      {state?.ok === false && <p className="sr-only" role="alert">{state.message}</p>}
    </form>
  );
}
