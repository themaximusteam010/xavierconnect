"use client";
import { useActionState } from "react";
import { changePasswordAction, createTicketAction, saveAddressAction, updateProfileAction } from "@/app/actions/account";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/feedback";
import { NIGERIAN_STATES } from "@/lib/validation";

export function AddressForm() {
  const [s, action] = useActionState(saveAddressAction, null);
  const e = s?.errors ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      {s?.message && <Alert tone={s.ok ? "success" : "danger"} className="sm:col-span-2">{s.message}</Alert>}
      <Field label="Label (e.g. Home, Office)" htmlFor="label"><Input id="label" name="label" /></Field>
      <Field label="Recipient name" htmlFor="fullName" error={e.fullName} required><Input id="fullName" name="fullName" /></Field>
      <Field label="Phone" htmlFor="phone" error={e.phone} required><Input id="phone" name="phone" type="tel" /></Field>
      <Field label="Street address" htmlFor="line1" error={e.line1} required><Input id="line1" name="line1" /></Field>
      <Field label="Apartment, landmark" htmlFor="line2"><Input id="line2" name="line2" /></Field>
      <Field label="City / LGA" htmlFor="city" error={e.city} required><Input id="city" name="city" /></Field>
      <Field label="State" htmlFor="state" error={e.state} required>
        <Select id="state" name="state" defaultValue=""><option value="">Choose state</option>{NIGERIAN_STATES.map((x) => <option key={x}>{x}</option>)}</Select>
      </Field>
      <div className="sm:col-span-2"><SubmitButton>Save address</SubmitButton></div>
    </form>
  );
}

export function ProfileForm({ name, phone }: { name: string; phone: string }) {
  const [s, action] = useActionState(updateProfileAction, null);
  return (
    <form action={action} className="max-w-md space-y-4">
      {s?.message && <Alert tone={s.ok ? "success" : "danger"}>{s.message}</Alert>}
      <Field label="Full name" htmlFor="name" error={s?.errors?.name}><Input id="name" name="name" defaultValue={name} /></Field>
      <Field label="Phone" htmlFor="phone"><Input id="phone" name="phone" type="tel" defaultValue={phone} /></Field>
      <SubmitButton variant="secondary">Save profile</SubmitButton>
    </form>
  );
}

export function PasswordForm() {
  const [s, action] = useActionState(changePasswordAction, null);
  return (
    <form action={action} className="max-w-md space-y-4">
      {s?.message && <Alert tone={s.ok ? "success" : "danger"}>{s.message}</Alert>}
      <Field label="Current password" htmlFor="current" error={s?.errors?.current}><Input id="current" name="current" type="password" autoComplete="current-password" /></Field>
      <Field label="New password" htmlFor="next" error={s?.errors?.next}><Input id="next" name="next" type="password" autoComplete="new-password" /></Field>
      <SubmitButton variant="secondary">Change password</SubmitButton>
    </form>
  );
}

export function TicketForm({ order }: { order?: string }) {
  const [s, action] = useActionState(createTicketAction, null);
  const e = s?.errors ?? {};
  return (
    <form action={action} className="max-w-2xl space-y-4" noValidate>
      {s?.message && <Alert tone="danger">{s.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Topic" htmlFor="category" error={e.category} required>
          <Select id="category" name="category" defaultValue={s?.values?.category ?? (order ? "Order problem" : "")}>
            <option value="" disabled>Choose a topic</option>
            {["Order problem", "Payment", "Refund", "Delivery", "Digital download", "Booking", "Account", "Selling on XavierConnect", "Other"].map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Order number (if any)" htmlFor="orderNumber"><Input id="orderNumber" name="orderNumber" defaultValue={s?.values?.orderNumber ?? order ?? ""} placeholder="XC-10001" /></Field>
      </div>
      <Field label="Subject" htmlFor="subject" error={e.subject} required><Input id="subject" name="subject" defaultValue={s?.values?.subject} /></Field>
      <Field label="What happened?" htmlFor="body" error={e.body} required><Textarea id="body" name="body" rows={6} defaultValue={s?.values?.body} /></Field>
      <Field label="How urgent is this?" htmlFor="priority">
        <Select id="priority" name="priority" defaultValue="NORMAL"><option value="LOW">Not urgent</option><option value="NORMAL">Normal</option><option value="HIGH">Urgent — money or delivery at risk</option></Select>
      </Field>
      <SubmitButton>Open ticket</SubmitButton>
    </form>
  );
}
