"use client";
import { useActionState } from "react";
import { placeOrderAction } from "@/app/actions/checkout";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/feedback";
import { NIGERIAN_STATES } from "@/lib/validation";

interface Addr { fullName: string; phone: string; line1: string; line2: string | null; city: string; state: string }

export function CheckoutForm({ needsAddress, guest, shipping, defaults, totalLabel, sandbox }: { needsAddress: boolean; guest: boolean; shipping: Record<string, string>; defaults?: Addr | null; totalLabel: string; sandbox: boolean }) {
  const [s, action] = useActionState(placeOrderAction, null);
  const v = (k: string) => s?.values?.[k] ?? (defaults as Record<string, string | null> | null | undefined)?.[k] ?? "";
  const e = s?.errors ?? {};
  return (
    <form action={action} className="space-y-8" noValidate>
      {s?.message && <Alert tone="danger">{s.message}</Alert>}
      <input type="hidden" name="needsAddress" value={needsAddress ? "1" : "0"} />
      {Object.entries(shipping).map(([vendor, method]) => <input key={vendor} type="hidden" name={`ship_${vendor}`} value={method} />)}

      {guest && (
        <section>
          <h2 className="mb-4 font-semibold">Contact</h2>
          <Field label="Email for your receipt" htmlFor="email" error={e.email} required>
            <Input id="email" name="email" type="email" autoComplete="email" defaultValue={v("email")} aria-invalid={!!e.email} />
          </Field>
          <p className="mt-2 text-[13px] text-ink-muted">Checking out as a guest. <a href="/login?next=/checkout" className="text-brand underline">Sign in</a> to track orders and get download access in your account.</p>
        </section>
      )}

      {needsAddress && (
        <section>
          <h2 className="mb-4 font-semibold">Delivery address</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Recipient name" htmlFor="fullName" error={e.fullName} required><Input id="fullName" name="fullName" autoComplete="name" defaultValue={v("fullName")} aria-invalid={!!e.fullName} /></Field>
            <Field label="Phone number" htmlFor="phone" error={e.phone} required><Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="0803 123 4567" defaultValue={v("phone")} aria-invalid={!!e.phone} /></Field>
            <Field label="Street address" htmlFor="line1" error={e.line1} required className="sm:col-span-2"><Input id="line1" name="line1" autoComplete="address-line1" defaultValue={v("line1")} aria-invalid={!!e.line1} /></Field>
            <Field label="Apartment, landmark (optional)" htmlFor="line2" className="sm:col-span-2"><Input id="line2" name="line2" autoComplete="address-line2" defaultValue={v("line2")} /></Field>
            <Field label="City / LGA" htmlFor="city" error={e.city} required><Input id="city" name="city" autoComplete="address-level2" defaultValue={v("city")} aria-invalid={!!e.city} /></Field>
            <Field label="State" htmlFor="state" error={e.state} required>
              <Select id="state" name="state" defaultValue={v("state")} aria-invalid={!!e.state}>
                <option value="">Choose state</option>
                {NIGERIAN_STATES.map((st) => <option key={st}>{st}</option>)}
              </Select>
            </Field>
          </div>
          {!guest && !defaults && <Checkbox name="saveAddress" defaultChecked label="Save this address to my account" className="mt-4" />}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">Payment</h2>
        {sandbox ? (
          <Alert tone="warning" title="Test mode">Payments are simulated on this environment. No card will be charged and no money moves.</Alert>
        ) : (
          <p className="text-sm text-ink-muted">You will be taken to our payment partner to pay by card, bank transfer or USSD.</p>
        )}
        <SubmitButton size="lg" className="w-full" pendingLabel="Reserving your items…">Pay {totalLabel}</SubmitButton>
        <p className="text-center text-[12px] text-ink-muted">Items are reserved for 30 minutes while you pay.</p>
      </section>
    </form>
  );
}
