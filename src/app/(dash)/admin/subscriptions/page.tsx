import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { savePlanAction, assignPlanAction } from "@/app/actions/admin-ops";
import { PageHeader } from "@/components/ui/page-header";
import { Alert, FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney, minorToInput } from "@/lib/money";

export const metadata = { title: "Subscriptions" };

export default async function Subscriptions({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await guard("commission.manage");
  const sp = await searchParams;
  const [plans, subs, vendors] = await Promise.all([
    db.subscriptionPlan.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { subscriptions: true } } } }),
    db.vendorSubscription.findMany({ orderBy: { currentPeriodEnd: "asc" }, take: 200, include: { plan: { select: { name: true } }, vendor: { select: { businessName: true } } } }),
    db.vendor.findMany({ where: { status: "APPROVED" }, orderBy: { businessName: "asc" }, select: { id: true, businessName: true } }),
  ]);
  return (
    <>
      <PageHeader title="Subscriptions" description="Plans set listing limits and the commission rate applied to new orders." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <Alert tone="warning" className="mb-6">Recurring billing for paid plans is not automated. Assigning a paid plan here does not charge the vendor — invoice them separately until card-on-file billing is integrated.</Alert>
      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => (
          <form key={p.id} action={savePlanAction} className="space-y-2 rounded-lg border border-line bg-white p-4 text-[13px]">
            <input type="hidden" name="id" value={p.id} />
            <p className="flex items-center justify-between font-mono text-[11px] text-ink-muted">{p.key}<span>{p._count.subscriptions} vendors</span></p>
            <label className="block">Name<Input name="name" defaultValue={p.name} required /></label>
            <label className="block">Price per {p.interval} (₦)<Input name="price" defaultValue={minorToInput(p.priceMinor)} inputMode="decimal" /></label>
            <label className="block">Listing limit<Input name="listingLimit" type="number" min={1} defaultValue={p.listingLimit ?? ""} placeholder="Unlimited" /></label>
            <label className="block">Commission %<Input name="commission" inputMode="decimal" defaultValue={p.commissionBps != null ? (p.commissionBps / 100).toString() : ""} placeholder="Use category/default rule" /></label>
            <label className="block">Features (one per line)<Textarea name="features" rows={4} defaultValue={p.features.join("\n")} /></label>
            <Checkbox name="active" label="Offered to new vendors" defaultChecked={p.active} />
            <SubmitButton size="sm">Save plan</SubmitButton>
          </form>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Table>
          <thead><tr><Th>Vendor</Th><Th>Plan</Th><Th>Status</Th><Th>Period ends</Th></tr></thead>
          <tbody>
            {subs.length === 0 && <tr><Td colSpan={4} className="py-6 text-center text-ink-muted">No vendor subscriptions yet; vendors without one use the default commission.</Td></tr>}
            {subs.map((s) => <tr key={s.id}><Td>{s.vendor.businessName}</Td><Td>{s.plan.name}</Td><Td><StatusBadge status={s.status} /></Td><Td className={s.currentPeriodEnd < new Date() ? "text-danger" : ""}>{s.currentPeriodEnd.toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td></tr>)}
          </tbody>
        </Table>
        <form action={assignPlanAction} className="h-fit space-y-3 rounded-lg border border-line bg-white p-4 text-[13px]">
          <p className="font-semibold">Assign a plan</p>
          <Select name="vendorId" required>{vendors.map((v) => <option key={v.id} value={v.id}>{v.businessName}</option>)}</Select>
          <Select name="planId" required>{plans.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.priceMinor)}</option>)}</Select>
          <label className="block">Months<Input name="months" type="number" min={1} max={12} defaultValue={1} /></label>
          <SubmitButton size="sm">Assign</SubmitButton>
        </form>
      </div>
    </>
  );
}
