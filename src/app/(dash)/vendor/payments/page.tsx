import Link from "next/link";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { corridorsFor, adapterName } from "@/server/services/payouts";
import { PageHeader } from "@/components/ui/page-header";
import { Alert, Badge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { countryName } from "@/lib/countries";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Payments" };

const CORRIDOR_TEXT: Record<string, [string, "success" | "warning" | "neutral" | "info"]> = {
  LIVE: ["Available", "success"],
  SANDBOX: ["Test mode only", "info"],
  PENDING_APPROVAL: ["Awaiting partner / compliance approval", "warning"],
  DISABLED: ["Not available", "neutral"],
};

export default async function Payments() {
  const { vendorId, vendor } = await requireVendor("finance");
  const [corr, ben, failed] = await Promise.all([
    corridorsFor(vendor.country),
    db.beneficiary.findFirst({ where: { vendorId, isDefault: true, status: "VERIFIED" } }),
    db.payout.findMany({ where: { vendorId, status: { in: ["FAILED", "REJECTED"] }, updatedAt: { gte: new Date(Date.now() - 30 * 864e5) } }, orderBy: { updatedAt: "desc" }, take: 5 }),
  ]);
  const ready = corr.usable.some((c) => c.currency === vendor.payoutCurrency) || (vendor.country === "NG" && vendor.payoutCurrency === "NGN");
  return (
    <>
      <PageHeader title="Payments" description="How buyers pay and how you get paid." />
      {failed.length > 0 && <Alert tone="danger" title="Recent withdrawals that did not complete" className="mb-6">{failed.map((p) => <p key={p.id}>{formatMoney(p.amountMinor)} on {p.updatedAt.toLocaleDateString("en-NG")}: {p.failureReason ?? "not completed"}. The amount was returned to your available balance.</p>)}</Alert>}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-line bg-white p-4 text-sm"><p className="text-ink-muted">Registered in</p><p className="text-lg font-semibold">{countryName(vendor.country)}</p></div>
        <div className="rounded-lg border border-line bg-white p-4 text-sm"><p className="text-ink-muted">Buyers pay</p><p className="text-lg font-semibold">Nigerian naira (NGN)</p><p className="text-[12px] text-ink-muted">Card, transfer or USSD through our payment processor. Your prices are set in naira.</p></div>
        <div className="rounded-lg border border-line bg-white p-4 text-sm"><p className="text-ink-muted">You are paid in</p><p className="text-lg font-semibold">{vendor.payoutCurrency}</p><p className="text-[12px]">{ben ? <>To {ben.bankName} ••••{ben.accountLast4}</> : <Link href="/vendor/bank-accounts" className="text-brand underline">Add a bank account</Link>}</p></div>
      </div>
      {!ready && <Alert tone="warning" title="Payouts to your country are not live yet" className="mb-6">You can sell now; earnings are recorded in your balance. Withdrawals open once our licensed partner for {countryName(vendor.country)} / {vendor.payoutCurrency} is approved. We do not move money across borders ourselves.</Alert>}
      <h2 className="mb-2 font-semibold">Payout routes for {countryName(vendor.country)}</h2>
      <Table>
        <thead><tr><Th>Currency</Th><Th>Partner</Th><Th>Type</Th><Th>Status</Th></tr></thead>
        <tbody>
          {vendor.country === "NG" && <tr><Td>NGN</Td><Td>Manual bank transfer by XavierConnect finance</Td><Td>Local</Td><Td><Badge tone="success">Available</Badge></Td></tr>}
          {corr.all.map((c) => { const [t, tone] = CORRIDOR_TEXT[c.status] ?? [c.status, "neutral"]; return <tr key={c.id}><Td>{c.currency}</Td><Td>{adapterName(c.providerKey)}</Td><Td>{c.method === "CROSS_BORDER" ? "International (with currency conversion)" : "Local"}</Td><Td><Badge tone={c.status === "LIVE" && !c.complianceApproved ? "warning" : tone}>{c.status === "LIVE" && !c.complianceApproved ? "Awaiting compliance approval" : t}</Badge></Td></tr>; })}
          {corr.all.length === 0 && vendor.country !== "NG" && <tr><Td colSpan={4} className="py-6 text-center text-ink-muted">No payout partner is configured for your country yet.</Td></tr>}
        </tbody>
      </Table>
      <p className="mt-4 text-[12px] text-ink-muted">International payouts are converted at the rate quoted by our payment partner at the time of transfer. The rate, the partner&apos;s fee and the amount you receive are shown on each payout.</p>
    </>
  );
}
