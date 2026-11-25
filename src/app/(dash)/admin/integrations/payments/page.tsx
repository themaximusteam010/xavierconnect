import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { PAYMENT_ADAPTERS } from "@/server/integrations/registry";
import { saveCorridorAction } from "@/app/actions/admin-ops";
import { ProviderCard } from "@/components/admin/provider-card";
import { PageHeader } from "@/components/ui/page-header";
import { Alert, Badge, FlashFromQuery } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { countryName } from "@/lib/countries";

export const metadata = { title: "Payment providers" };

export default async function PaymentProviders({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const u = await guard("integrations.view");
  const sp = await searchParams;
  const canManage = u.permissions.has("integrations.manage");
  const [rows, corridors] = await Promise.all([db.integrationProvider.findMany({ where: { kind: "PAYMENT" } }), db.payoutCorridor.findMany({ orderBy: [{ country: "asc" }, { providerKey: "asc" }] })]);
  return (
    <>
      <PageHeader eyebrow="Integrations" title="Payment providers" description="Collection, payout, FX and beneficiary-onboarding partners. Credentials are encrypted at rest and never shown again." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <Alert tone="info" className="mb-6" title="XavierConnect does not hold customer funds or perform FX itself">Collection, safeguarding, currency conversion and payout are performed by licensed partners. A corridor is enabled only when its partner is approved and compliance sign-off is recorded below.</Alert>

      <section className="mb-8">
        <h2 className="mb-2 font-semibold">Payout corridors</h2>
        <p className="mb-3 text-[13px] text-ink-muted">Which partner pays vendors in each country and currency. Vendors can only add payout accounts on corridors that are enabled.</p>
        <Table>
          <thead><tr><Th>Vendor country</Th><Th>Currency</Th><Th>Provider</Th><Th>Method</Th><Th>Status</Th><Th>Compliance</Th><Th /></tr></thead>
          <tbody>{corridors.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium text-ink">{countryName(c.country)}</Td><Td>{c.currency}</Td><Td>{PAYMENT_ADAPTERS.find((a) => a.key === c.providerKey)?.name ?? c.providerKey}</Td><Td>{c.method === "CROSS_BORDER" ? "Cross-border" : "Local"}</Td>
              <Td><Badge tone={c.status === "LIVE" ? "success" : c.status === "SANDBOX" ? "warning" : "neutral"}>{c.status.toLowerCase()}</Badge></Td>
              <Td className="max-w-sm text-[12px]">{c.complianceApproved ? <span className="text-success">Approved. </span> : null}{c.complianceNote}</Td>
              <Td>{canManage && (
                <form action={saveCorridorAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={c.id} />
                  <Select name="status" defaultValue={c.status} className="h-8 w-28 text-[12px]"><option value="DISABLED">Disabled</option><option value="SANDBOX">Sandbox</option><option value="LIVE">Live</option></Select>
                  <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" name="complianceApproved" defaultChecked={c.complianceApproved} className="accent-[var(--color-brand)]" />Compliance approved</label>
                  <Input name="complianceNote" defaultValue={c.complianceNote ?? ""} className="h-8 w-56 text-[12px]" aria-label="Compliance note" />
                  <SubmitButton size="sm" variant="secondary" confirm="Change this payout corridor?">Save</SubmitButton>
                </form>
              )}</Td>
            </tr>
          ))}</tbody>
        </Table>
      </section>

      <div className="space-y-4">
        {PAYMENT_ADAPTERS.map((a) => <ProviderCard key={a.key} adapter={a} row={rows.find((r) => r.key === a.key) ?? null} back="/admin/integrations/payments" canManage={canManage} />)}
      </div>
      <p className="mt-6 text-[12px] text-ink-muted">Collection provider for checkout is still selected by the PAYMENT_PROVIDER environment variable (sandbox or paystack). Per-environment configuration: set different keys in Vercel for Development, Preview and Production.</p>
    </>
  );
}
