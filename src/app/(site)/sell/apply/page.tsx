import Link from "next/link";
import { Check, FileText } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { getApplication } from "@/server/services/vendors";
import { acceptAgreementAndSubmitAction, chooseTypeAction, saveBusinessAction, savePayoutAction, saveShippingAction, saveStoreAction, uploadDocumentAction } from "@/app/actions/onboarding";
import { Alert, StatusBadge } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ButtonLink } from "@/components/ui/button";
import { ResendVerification } from "@/components/auth-forms";
import { minorToInput } from "@/lib/money";
import { NIGERIAN_STATES } from "@/lib/validation";
import { cn } from "@/lib/cn";
import { BANKS } from "@/lib/banks";

export const metadata = { title: "Seller application", robots: { index: false } };


export default async function Apply({ searchParams }: { searchParams: Promise<{ step?: string; error?: string; submitted?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/sell/apply");
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  const v = await getApplication(user.id);
  const service = v?.type === "SERVICE_PROVIDER";
  const steps = [
    { n: 1, label: "Account", done: !!row.emailVerifiedAt },
    { n: 2, label: "Seller type", done: !!v },
    { n: 3, label: "Business", done: !!v?.addressLine1 && !!v?.description },
    { n: 4, label: "Verification", done: (v?.documents.length ?? 0) > 0 },
    { n: 5, label: "Storefront", done: !!v?.store },
    { n: 6, label: "Payouts", done: !!v?.payoutAccount },
    ...(!service ? [{ n: 7, label: "Delivery", done: (v?.shippingMethods.length ?? 0) > 0 }] : []),
    { n: 8, label: "Review & submit", done: !!v?.submittedAt },
  ];
  const firstOpen = steps.find((s) => !s.done)?.n ?? 8;
  const step = Math.min(Number(sp.step) || firstOpen, row.emailVerifiedAt ? 8 : 1);
  const locked = v && !["DRAFT", "CHANGES_REQUESTED"].includes(v.status);

  return (
    <div className="container-x py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Seller application</h1><p className="mt-1 text-sm text-ink-muted">Your progress is saved after each step.</p></div>
        {v && <StatusBadge status={v.status} />}
      </div>
      <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
        <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1" aria-label="Application steps">
          {steps.map((s, i) => (
            <li key={s.n} className="shrink-0">
              <Link href={`/sell/apply?step=${s.n}`} aria-current={step === s.n ? "step" : undefined} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm", step === s.n ? "bg-sunken font-medium" : "text-ink-2 hover:bg-sunken")}>
                <span className={cn("flex size-6 items-center justify-center rounded-full text-[12px]", s.done ? "bg-success text-white" : step === s.n ? "bg-ink text-white" : "border border-line-strong text-ink-muted")}>{s.done ? <Check className="size-3.5" /> : i + 1}</span>{s.label}
              </Link>
            </li>
          ))}
        </ol>

        <div className="max-w-2xl">
          {sp.error && <Alert tone="danger" className="mb-6">{sp.error}</Alert>}
          {sp.submitted && <Alert tone="success" title="Application submitted" className="mb-6">We'll email you when it's reviewed — usually within two business days.</Alert>}
          {v?.status === "CHANGES_REQUESTED" && <Alert tone="warning" title="Changes requested" className="mb-6">{v.reviewNote}</Alert>}
          {v?.status === "REJECTED" && <Alert tone="danger" title="Application not approved" className="mb-6">{v.reviewNote}</Alert>}
          {v?.status === "APPROVED" && <Alert tone="success" title="You're approved" className="mb-6"><Link href="/vendor" className="underline">Open your seller dashboard</Link></Alert>}
          {locked && v?.status === "SUBMITTED" && <Alert tone="info" className="mb-6">Your application is under review and can't be edited right now.</Alert>}

          {step === 1 && (
            row.emailVerifiedAt ? <Alert tone="success">Your account is verified. <Link href="/sell/apply?step=2" className="underline">Continue</Link></Alert> : (
              <div className="space-y-4"><h2 className="text-lg font-semibold">Confirm your email</h2><p className="text-sm text-ink-2">We sent a link to <b>{row.email}</b>. Sellers must have a verified email before applying.</p><ResendVerification /></div>
            )
          )}

          {step === 2 && (
            <form action={chooseTypeAction} className="space-y-4">
              <h2 className="text-lg font-semibold">How will you sell?</h2>
              {[["INDIVIDUAL", "Individual seller", "You sell as yourself, without a registered company."], ["BUSINESS", "Registered business", "You have a CAC registration (RC or BN number)."], ["SERVICE_PROVIDER", "Service provider", "You offer services such as design, repairs, cleaning or tutoring."]].map(([val, t, d]) => (
                <label key={val} className="flex cursor-pointer gap-3 rounded-lg border border-line p-4 has-[:checked]:border-ink">
                  <input type="radio" name="type" value={val} defaultChecked={v?.type === val} className="mt-1 accent-[var(--color-brand)]" disabled={!!locked} />
                  <span><span className="font-medium">{t}</span><span className="block text-sm text-ink-muted">{d}</span></span>
                </label>
              ))}
              <SubmitButton disabled={!!locked}>Continue</SubmitButton>
            </form>
          )}

          {step === 3 && v && (
            <form action={saveBusinessAction} className="space-y-4">
              <h2 className="text-lg font-semibold">About your business</h2>
              <Field label={v.type === "BUSINESS" ? "Registered business name" : "Business or trading name"} htmlFor="businessName" required><Input id="businessName" name="businessName" defaultValue={v.businessName} /></Field>
              {v.type === "BUSINESS" && <Field label="CAC RC / BN number" htmlFor="rcNumber" required><Input id="rcNumber" name="rcNumber" defaultValue={v.rcNumber ?? ""} /></Field>}
              <Field label="What do you sell?" htmlFor="description" required hint="At least 30 characters. Buyers won't see this; it helps our review."><Textarea id="description" name="description" defaultValue={v.description ?? ""} /></Field>
              <Field label="Main category" htmlFor="businessCategory" required><Input id="businessCategory" name="businessCategory" defaultValue={v.businessCategory ?? ""} placeholder="e.g. Fashion, Electronics, Photography" /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business email" htmlFor="email" required><Input id="email" name="email" type="email" defaultValue={v.email} /></Field>
                <Field label="Business phone" htmlFor="phone" required><Input id="phone" name="phone" type="tel" defaultValue={v.phone} /></Field>
                <Field label="Website" htmlFor="website"><Input id="website" name="website" type="url" defaultValue={v.website ?? ""} placeholder="https://" /></Field>
                <Field label="Instagram handle" htmlFor="instagram"><Input id="instagram" name="instagram" defaultValue={(v.socialLinks as { instagram?: string } | null)?.instagram ?? ""} placeholder="@yourbrand" /></Field>
              </div>
              <Field label="Business address" htmlFor="addressLine1" required><Input id="addressLine1" name="addressLine1" defaultValue={v.addressLine1 ?? ""} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="City" htmlFor="city" required><Input id="city" name="city" defaultValue={v.city ?? ""} /></Field>
                <Field label="State" htmlFor="state" required><Select id="state" name="state" defaultValue={v.state ?? ""}><option value="">Choose</option>{NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
              </div>
              <SubmitButton disabled={!!locked}>Save and continue</SubmitButton>
            </form>
          )}

          {step === 4 && v && (
            <div className="space-y-6">
              <div><h2 className="text-lg font-semibold">Verify your identity</h2><p className="mt-1 text-sm text-ink-muted">Upload a government ID (NIN slip, driver's licence, international passport or voter's card){v.type === "BUSINESS" ? " and your CAC certificate" : ""}. Files are stored privately and only seen by our verification team.</p></div>
              {v.documents.length > 0 && <ul className="divide-y divide-line rounded-lg border border-line text-sm">{v.documents.map((d) => <li key={d.id} className="flex items-center justify-between px-4 py-3"><span className="flex items-center gap-2"><FileText className="size-4 text-ink-muted" />{d.type.replace(/_/g, " ").toLowerCase()} · {d.fileName}</span><StatusBadge status={d.status} /></li>)}</ul>}
              <form action={uploadDocumentAction} className="space-y-4 rounded-lg border border-line p-4">
                <Field label="Document type" htmlFor="type"><Select id="type" name="type"><option value="GOVERNMENT_ID">Government-issued ID</option><option value="CAC_CERTIFICATE">CAC certificate</option><option value="UTILITY_BILL">Utility bill (proof of address)</option><option value="PROFESSIONAL_CERTIFICATE">Professional certificate</option></Select></Field>
                <Field label="File" htmlFor="file" hint="PDF, JPG or PNG, up to 10 MB."><input id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png" required className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-sunken file:px-3 file:py-2 file:text-sm" /></Field>
                <SubmitButton variant="secondary" disabled={!!locked}>Upload</SubmitButton>
              </form>
              {v.documents.length > 0 && <ButtonLink href="/sell/apply?step=5">Continue</ButtonLink>}
            </div>
          )}

          {step === 5 && v && (
            <form action={saveStoreAction} className="space-y-4">
              <h2 className="text-lg font-semibold">Your storefront</h2>
              <Field label="Store name" htmlFor="name" required hint={v.store ? `Your store address: /store/${v.store.slug}` : "We'll create your store web address from this."}><Input id="name" name="name" defaultValue={v.store?.name ?? v.businessName} /></Field>
              <Field label="Tagline" htmlFor="tagline" hint="One line buyers see under your name."><Input id="tagline" name="tagline" defaultValue={v.store?.tagline ?? ""} maxLength={120} /></Field>
              <Field label="About your store" htmlFor="storeDescription"><Textarea id="storeDescription" name="storeDescription" defaultValue={v.store?.description ?? ""} rows={5} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Public contact email" htmlFor="contactEmail"><Input id="contactEmail" name="contactEmail" type="email" defaultValue={v.store?.contactEmail ?? ""} /></Field>
                <Field label="Public contact phone" htmlFor="contactPhone"><Input id="contactPhone" name="contactPhone" defaultValue={v.store?.contactPhone ?? ""} /></Field>
              </div>
              <Field label="Logo" htmlFor="logo" hint="Square JPG, PNG or WebP, up to 5 MB."><input id="logo" name="logo" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-sunken file:px-3 file:py-2 file:text-sm" /></Field>
              <SubmitButton disabled={!!locked}>Save and continue</SubmitButton>
            </form>
          )}

          {step === 6 && v && (
            <form action={savePayoutAction} className="space-y-4">
              <h2 className="text-lg font-semibold">Where should we pay you?</h2>
              <p className="text-sm text-ink-muted">Use a Nigerian bank account in your name{v.type === "BUSINESS" ? " or your business's name" : ""}. We only keep the last four digits; the full number is held by our payment provider.</p>
              {v.payoutAccount && <Alert tone="success">Current: {v.payoutAccount.bankName} ••••{v.payoutAccount.accountNumberLast4} ({v.payoutAccount.accountName})</Alert>}
              <Field label="Bank" htmlFor="bankCode" required>
                <Select id="bankCode" name="bankCode" defaultValue={v.payoutAccount?.bankCode ?? ""}><option value="">Choose your bank</option>{BANKS.map(([n, c]) => <option key={c} value={c}>{n}</option>)}</Select>
              </Field>
              <Field label="Account number" htmlFor="accountNumber" required><Input id="accountNumber" name="accountNumber" inputMode="numeric" maxLength={10} pattern="\d{10}" /></Field>
              <Field label="Account name" htmlFor="accountName" required hint="Exactly as it appears on your bank statement."><Input id="accountName" name="accountName" defaultValue={v.payoutAccount?.accountName ?? ""} /></Field>
              <SubmitButton>Save payout account</SubmitButton>
            </form>
          )}

          {step === 7 && v && !service && (
            <form action={saveShippingAction} className="space-y-4">
              <h2 className="text-lg font-semibold">Delivery</h2>
              <p className="text-sm text-ink-muted">Set simple flat prices now; you can add weight-based rates and more zones later from your dashboard.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Within ${v.state ?? "your state"} (₦)`} htmlFor="localRate" hint="Leave blank if you don't offer it."><Input id="localRate" name="localRate" inputMode="decimal" defaultValue={minorToInput(v.shippingMethods.find((m) => m.states.length)?.rateMinor)} /></Field>
                <Field label="Nationwide (₦)" htmlFor="nationalRate"><Input id="nationalRate" name="nationalRate" inputMode="decimal" defaultValue={minorToInput(v.shippingMethods.find((m) => m.type === "FLAT" && !m.states.length)?.rateMinor)} /></Field>
                <Field label="Free delivery on orders over (₦)" htmlFor="freeOver" hint="Optional."><Input id="freeOver" name="freeOver" inputMode="decimal" /></Field>
              </div>
              <Checkbox name="pickup" defaultChecked={v.shippingMethods.some((m) => m.type === "PICKUP")} label="Buyers can pick up from me" />
              <SubmitButton disabled={!!locked}>Save and continue</SubmitButton>
            </form>
          )}

          {step === 8 && v && (
            <form action={acceptAgreementAndSubmitAction} className="space-y-5">
              <h2 className="text-lg font-semibold">Review and submit</h2>
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {steps.filter((s) => s.n > 1 && s.n < 8).map((s) => <li key={s.n} className="flex items-center justify-between px-4 py-3"><span>{s.label}</span>{s.done ? <span className="text-success">Complete</span> : <Link href={`/sell/apply?step=${s.n}`} className="text-brand underline">Finish this step</Link>}</li>)}
              </ul>
              <Checkbox name="agree" defaultChecked={!!v.agreementAcceptedAt} label={<>I have read and accept the <Link href="/legal/vendor-agreement" target="_blank" className="text-brand underline">Vendor Agreement</Link>, including commission and settlement terms, and confirm the information I provided is accurate.</>} />
              <SubmitButton disabled={!!locked} pendingLabel="Submitting…">Submit application</SubmitButton>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
