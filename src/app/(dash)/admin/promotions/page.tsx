import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { createPlatformCouponAction, toggleAnyCouponAction } from "@/app/actions/admin-ops";
import { FilterBar } from "@/components/admin/filters";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, Badge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Promotions" };

export default async function Promotions({ searchParams }: { searchParams: Promise<{ funded?: string; ok?: string; error?: string }> }) {
  await guard("cms.manage");
  const sp = await searchParams;
  const coupons = await db.coupon.findMany({ where: sp.funded === "platform" ? { vendorId: null } : sp.funded === "vendor" ? { vendorId: { not: null } } : {}, orderBy: { createdAt: "desc" }, take: 200, include: { vendor: { select: { businessName: true } } } });
  const now = new Date();
  return (
    <>
      <PageHeader title="Promotions" description="Platform-funded coupons are charged to the promotions ledger account; vendor coupons reduce that vendor's earnings." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <FilterBar action="/admin/promotions" values={sp} fields={[{ type: "select", name: "funded", label: "Funded by", options: [["platform", "Platform"], ["vendor", "Vendor"]] }]} />
          <Table>
            <thead><tr><Th>Code</Th><Th>Funded by</Th><Th>Discount</Th><Th className="text-right">Used</Th><Th>Ends</Th><Th>State</Th><Th /></tr></thead>
            <tbody>
              {coupons.length === 0 && <tr><Td colSpan={7} className="py-6 text-center text-ink-muted">No coupons.</Td></tr>}
              {coupons.map((c) => {
                const expired = c.endsAt && c.endsAt < now;
                return (
                  <tr key={c.id}>
                    <Td className="font-mono">{c.code}</Td>
                    <Td>{c.vendor?.businessName ?? <Badge tone="info">platform</Badge>}</Td>
                    <Td>{c.type === "PERCENT" ? `${c.value / 100}%` : formatMoney(BigInt(c.value))}{c.minSubtotalMinor > 0n && <span className="block text-[11px] text-ink-muted">min {formatMoney(c.minSubtotalMinor)}</span>}</Td>
                    <Td className="tabular text-right">{c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : ""}</Td>
                    <Td>{c.endsAt?.toLocaleDateString("en-NG", { dateStyle: "medium" }) ?? "—"}</Td>
                    <Td><Badge tone={expired ? "neutral" : c.active ? "success" : "warning"}>{expired ? "expired" : c.active ? "active" : "paused"}</Badge></Td>
                    <Td>{!expired && <form action={toggleAnyCouponAction}><input type="hidden" name="id" value={c.id} /><SubmitButton size="sm" variant="ghost">{c.active ? "Pause" : "Resume"}</SubmitButton></form>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
        <form action={createPlatformCouponAction} className="h-fit space-y-3 rounded-lg border border-line bg-white p-4 text-[13px]">
          <p className="font-semibold">New platform coupon</p>
          <label className="block">Code<Input name="code" required pattern="[A-Za-z0-9]{4,20}" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">Type<Select name="type"><option value="PERCENT">Percent</option><option value="FIXED">Fixed ₦</option></Select></label>
            <label className="block">Value<Input name="value" required inputMode="decimal" /></label>
          </div>
          <label className="block">Minimum basket (₦)<Input name="minSubtotal" inputMode="decimal" /></label>
          <label className="block">Maximum discount (₦)<Input name="maxDiscount" inputMode="decimal" /></label>
          <label className="block">Maximum uses<Input name="maxUses" type="number" min={1} /></label>
          <label className="block">Ends<Input name="endsAt" type="date" /></label>
          <SubmitButton size="sm">Create</SubmitButton>
        </form>
      </div>
    </>
  );
}
