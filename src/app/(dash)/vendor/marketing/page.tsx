import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { createCouponAction, toggleCouponAction } from "@/app/actions/vendor";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Field, Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Coupons" };

export default async function Marketing({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { vendorId } = await requireVendor("catalog");
  const sp = await searchParams;
  const coupons = await db.coupon.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader title="Coupons" description="Codes apply only to your items. The discount is funded by you and reduces the amount commission is charged on." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      {coupons.length > 0 && (
        <Table className="mb-8">
          <thead><tr><Th>Code</Th><Th>Discount</Th><Th>Min spend</Th><Th>Used</Th><Th>Ends</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>{coupons.map((c) => (
            <tr key={c.id}>
              <Td className="font-mono font-medium text-ink">{c.code}</Td>
              <Td>{c.type === "PERCENT" ? `${c.value / 100}%` : formatMoney(c.value)}</Td>
              <Td className="tabular">{c.minSubtotalMinor > 0n ? formatMoney(c.minSubtotalMinor) : "—"}</Td>
              <Td className="tabular">{c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : ""}</Td>
              <Td>{c.endsAt?.toLocaleDateString("en-NG", { dateStyle: "medium" }) ?? "—"}</Td>
              <Td><StatusBadge status={c.active ? "ACTIVE" : "ARCHIVED"} /></Td>
              <Td><form action={toggleCouponAction}><input type="hidden" name="id" value={c.id} /><button className="text-[13px] text-brand">{c.active ? "Pause" : "Resume"}</button></form></Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      <form action={createCouponAction} className="grid max-w-3xl gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-3">
        <h2 className="font-semibold sm:col-span-3">New coupon</h2>
        <Field label="Code" htmlFor="code"><Input id="code" name="code" className="uppercase" placeholder="SAVE10" required /></Field>
        <Field label="Type" htmlFor="type"><Select id="type" name="type"><option value="PERCENT">Percentage off</option><option value="FIXED">Fixed amount off (₦)</option></Select></Field>
        <Field label="Value" htmlFor="value" hint="e.g. 10 for 10%, or 2000 for ₦2,000."><Input id="value" name="value" inputMode="decimal" required /></Field>
        <Field label="Minimum spend (₦)" htmlFor="minSubtotal"><Input id="minSubtotal" name="minSubtotal" inputMode="decimal" /></Field>
        <Field label="Maximum uses" htmlFor="maxUses"><Input id="maxUses" name="maxUses" type="number" min={1} /></Field>
        <Field label="Ends on" htmlFor="endsAt"><Input id="endsAt" name="endsAt" type="date" /></Field>
        <div className="sm:col-span-3"><SubmitButton>Create coupon</SubmitButton></div>
      </form>
    </>
  );
}
