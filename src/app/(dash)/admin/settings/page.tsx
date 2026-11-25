import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { saveSettingsAction } from "@/app/actions/admin-ops";
import { SETTING_DEFAULTS, type SettingKey } from "@/server/services/settings";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, Alert } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { minorToInput } from "@/lib/money";

export const metadata = { title: "Platform settings" };

const META: Record<SettingKey, { label: string; hint: string; unit?: string }> = {
  taxBps: { label: "VAT collected at checkout", hint: "Basis points: 750 = 7.5%. Only enable once the business is VAT-registered.", unit: "bps" },
  settlementHoldDays: { label: "Hold after verified delivery", hint: "Days after carrier, rider, customer or service-completion evidence before earnings become withdrawable.", unit: "days" },
  vendorClaimHoldDays: { label: "Hold when only the vendor says “delivered”", hint: "Longer hold when there is no independent delivery evidence.", unit: "days" },
  minPayoutMinor: { label: "Minimum payout", hint: "Smallest withdrawal a vendor can request.", unit: "₦" },
  reservationMinutes: { label: "Stock reservation for unpaid orders", hint: "Unpaid orders release stock after this.", unit: "minutes" },
  downloadMaxCount: { label: "Download limit per purchase", hint: "Times a buyer can download a digital file.", unit: "downloads" },
  downloadExpiryDays: { label: "Download link lifetime", hint: "Days a purchased download stays available.", unit: "days" },
  msgViolationWindowDays: { label: "Messaging: violation window", hint: "Confirmed contact-sharing or off-platform-payment violations are counted over this period.", unit: "days" },
  msgRestrictAfter: { label: "Messaging: restrict after", hint: "Confirmed violations in the window before sending is paused. The first one is a warning.", unit: "violations" },
  msgRestrictHours: { label: "Messaging: restriction length", hint: "How long an automatic restriction lasts.", unit: "hours" },
  msgReviewAfter: { label: "Messaging: admin review after", hint: "Confirmed violations before the account is flagged for a moderator. Suspension is always a staff decision.", unit: "violations" },
  msgBlockedRetentionDays: { label: "Messaging: blocked-content retention", hint: "Blocked message text and flagged attachments are purged after this.", unit: "days" },
};

export default async function Settings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await guard("settings.manage");
  const sp = await searchParams;
  const rows = await db.platformSetting.findMany();
  const current = (k: SettingKey) => (rows.find((r) => r.key === k)?.value ?? SETTING_DEFAULTS[k]) as string | number;
  const env = [
    ["Admin two-step verification", process.env.ADMIN_MFA_REQUIRED !== "false" ? "required" : "NOT required"],
    ["Sandbox payments in production", process.env.ALLOW_SANDBOX_PAYMENTS === "true" ? "allowed" : "refused"],
    ["Credential encryption key", process.env.ENCRYPTION_KEY ? "configured" : "MISSING — provider credentials cannot be saved"],
    ["Ops alert email", process.env.OPS_ALERT_EMAIL ? "configured" : "not set — critical alerts only appear in the back office"],
    ["Scheduled jobs secret", process.env.CRON_SECRET ? "configured" : "MISSING — settlement, retries and monitoring will not run"],
    ["File storage", process.env.STORAGE_DRIVER ?? "filesystem"],
  ];
  return (
    <>
      <PageHeader title="Platform settings" description="Changes apply immediately to new activity and are audit-logged. They never rewrite existing orders or ledger entries." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <form action={saveSettingsAction} className="space-y-4 rounded-lg border border-line bg-white p-5 text-[13px]">
          {(Object.keys(SETTING_DEFAULTS) as SettingKey[]).map((k) => (
            <label key={k} className="grid gap-1 sm:grid-cols-[1fr_180px] sm:items-center">
              <span><span className="font-medium">{META[k].label}</span><span className="block text-[12px] text-ink-muted">{META[k].hint}</span></span>
              <span className="flex items-center gap-2"><Input name={k} defaultValue={k === "minPayoutMinor" ? minorToInput(BigInt(current(k))) : String(current(k))} inputMode="decimal" required /><span className="w-16 text-[12px] text-ink-muted">{META[k].unit}</span></span>
            </label>
          ))}
          <SubmitButton>Save settings</SubmitButton>
        </form>
        <div className="space-y-3">
          <div className="rounded-lg border border-line bg-white p-4 text-[13px]">
            <p className="mb-2 font-semibold">Deployment configuration</p>
            <p className="mb-3 text-[12px] text-ink-muted">Set as environment variables on the host; read-only here. Secret values are never shown.</p>
            <dl className="space-y-1.5">{env.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-ink-muted">{k}</dt><dd className={`text-right ${/MISSING|NOT/.test(v) ? "text-danger" : ""}`}>{v}</dd></div>)}</dl>
          </div>
          <Alert>Payment providers, payout corridors and carriers are configured under <a href="/admin/integrations/payments" className="underline">Integrations</a>.</Alert>
        </div>
      </div>
    </>
  );
}
