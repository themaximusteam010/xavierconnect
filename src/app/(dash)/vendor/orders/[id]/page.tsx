import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { allowedNextStatuses } from "@/server/services/orders";
import { vendorOrderStatusAction } from "@/app/actions/vendor";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Input, Textarea } from "@/components/ui/form";
import { vendorDisputeReplyAction } from "@/app/actions/disputes";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";

const LABEL: Record<string, string> = { PROCESSING: "Accept and start preparing", READY_FOR_DISPATCH: "Mark ready for dispatch", SHIPPED: "Mark as shipped", DELIVERED: "Confirm delivered" };

export default async function VendorOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { vendorId } = await requireVendor("orders");
  const { id } = await params;
  const sp = await searchParams;
  // Tenant boundary: vendorId in the where clause. Another vendor's id returns 404.
  const vo = await db.vendorOrder.findFirst({
    where: { id, vendorId },
    include: { items: { include: { product: { select: { slug: true } } } }, order: { select: { number: true, shippingAddress: true, contactPhone: true, guestEmail: true, user: { select: { name: true } } } }, events: { orderBy: { createdAt: "asc" } }, shipments: true, disputes: { orderBy: { createdAt: "desc" }, include: { evidence: { orderBy: { createdAt: "asc" } } } } },
  });
  if (!vo) notFound();
  const a = vo.order.shippingAddress as { fullName: string; phone: string; line1: string; line2?: string; city: string; state: string } | null;
  const next = allowedNextStatuses(vo.status).filter((s) => s !== "CANCELLED");
  const canCancel = ["NEW", "PROCESSING"].includes(vo.status);
  const method = vo.shippingMethodId ? await db.shippingMethod.findUnique({ where: { id: vo.shippingMethodId } }) : null;
  const pd = vo.vendorNetMinor + vo.commissionMinor + vo.taxMinor - vo.totalMinor;

  return (
    <>
      <PageHeader eyebrow="Order" title={vo.number} description={<span className="flex items-center gap-2"><StatusBadge status={vo.status} /> Placed {vo.createdAt.toLocaleString("en-NG", { dateStyle: "long", timeStyle: "short" })}</span>} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      {vo.disputes.map((d) => (
        <section key={d.id} className={`mb-6 rounded-lg border p-4 text-sm ${["OPEN", "AWAITING_VENDOR", "UNDER_REVIEW"].includes(d.status) ? "border-amber-300 bg-warning-soft" : "border-line bg-white"}`}>
          <p className="font-semibold">Dispute: {d.reason} <StatusBadge status={d.status} /></p>
          {d.status === "AWAITING_VENDOR" && <p className="text-warning">Respond within 3 days of {d.createdAt.toLocaleDateString("en-NG")}. Your earnings for this order are on hold until the dispute is decided.</p>}
          <ol className="mt-2 space-y-1.5">{d.evidence.map((e) => <li key={e.id}><span className="text-ink-muted">{e.party === "VENDOR" ? "You" : e.party === "CUSTOMER" ? "Buyer" : "XavierConnect"} · {e.createdAt.toLocaleDateString("en-NG")}:</span> <span className="whitespace-pre-line">{e.body}</span></li>)}</ol>
          {d.resolution && <p className="mt-2"><span className="font-medium">Decision:</span> {d.resolution}</p>}
          {["OPEN", "AWAITING_VENDOR", "UNDER_REVIEW"].includes(d.status) && (
            <form action={vendorDisputeReplyAction} className="mt-3 space-y-2"><input type="hidden" name="disputeId" value={d.id} /><Textarea name="body" rows={3} required minLength={5} placeholder="Your response: dispatch date, courier and tracking, proof of delivery, photos of the item packed…" /><SubmitButton size="sm">Send response</SubmitButton></form>
          )}
        </section>
      ))}
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-line bg-white">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Items</h2>
            <ul className="divide-y divide-line">
              {vo.items.map((it) => <li key={it.id} className="flex justify-between gap-4 px-4 py-3 text-sm"><span><span className="font-medium">{it.name}</span>{it.sku && <span className="block text-[12px] text-ink-muted">SKU {it.sku}</span>}</span><span className="tabular text-right">{it.quantity} × {formatMoney(it.unitPriceMinor)}<span className="block font-medium">{formatMoney(it.lineTotalMinor)}</span></span></li>)}
            </ul>
            <dl className="tabular space-y-1.5 border-t border-line px-4 py-3 text-sm">
              <div className="flex justify-between"><dt className="text-ink-muted">Items</dt><dd>{formatMoney(vo.subtotalMinor)}</dd></div>
              {vo.discountMinor - pd > 0n && <div className="flex justify-between"><dt className="text-ink-muted">Your coupon discount</dt><dd>−{formatMoney(vo.discountMinor - pd)}</dd></div>}
              <div className="flex justify-between"><dt className="text-ink-muted">Delivery collected{method ? ` (${method.name})` : ""}</dt><dd>{formatMoney(vo.shippingMinor)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Marketplace commission</dt><dd>−{formatMoney(vo.commissionMinor)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Your earnings</dt><dd>{formatMoney(vo.vendorNetMinor)}</dd></div>
              {pd > 0n && <p className="pt-1 text-[12px] text-ink-muted">The buyer used a XavierConnect-funded discount of {formatMoney(pd)}; it doesn't reduce your earnings.</p>}
            </dl>
          </section>
          <section className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-3 font-semibold">Timeline</h2>
            <ol className="space-y-2 text-sm">{vo.events.map((e) => <li key={e.id} className="flex gap-3"><span className="tabular w-36 shrink-0 text-ink-muted">{e.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</span><span>{e.status.replace(/_/g, " ").toLowerCase()}{e.note ? ` — ${e.note}` : ""}</span></li>)}</ol>
          </section>
        </div>
        <aside className="space-y-6">
          {(next.length > 0 || canCancel) && (
            <section className="rounded-lg border border-line bg-white p-4">
              <h2 className="mb-3 font-semibold">Next step</h2>
              {next.map((s) => (
                <form key={s} action={vendorOrderStatusAction} className="space-y-3">
                  <input type="hidden" name="id" value={vo.id} /><input type="hidden" name="next" value={s} />
                  {s === "SHIPPED" && (<><Input name="carrier" placeholder="Carrier (e.g. GIG Logistics, own rider)" /><Input name="trackingNumber" placeholder="Tracking number (optional)" /></>)}
                  <SubmitButton className="w-full">{LABEL[s] ?? s}</SubmitButton>
                </form>
              ))}
              {canCancel && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-danger">Can't fulfil this order?</summary>
                  <form action={vendorOrderStatusAction} className="mt-3 space-y-2">
                    <input type="hidden" name="id" value={vo.id} /><input type="hidden" name="next" value="CANCELLED" />
                    <Input name="reason" placeholder="Reason shown to the buyer" required />
                    <SubmitButton variant="danger" size="sm" confirm="Cancel this order and refund the buyer in full?">Cancel and refund buyer</SubmitButton>
                  </form>
                </details>
              )}
            </section>
          )}
          {a && (
            <section className="rounded-lg border border-line bg-white p-4 text-sm">
              <h2 className="mb-2 font-semibold">Ship to</h2>
              <p className="font-medium">{a.fullName}</p><p>{a.line1}{a.line2 ? `, ${a.line2}` : ""}</p><p>{a.city}, {a.state}</p><p className="mt-1 text-ink-muted">{a.phone}</p>
            </section>
          )}
          {["NEW", "PROCESSING", "READY_FOR_DISPATCH"].includes(vo.status) && <a href={`/vendor/shipments?order=${vo.id}`} className="block rounded-lg border border-line bg-white p-4 text-sm text-brand hover:border-brand">Buy a carrier label for this order →</a>}
          {vo.status === "SHIPPED" && <p className="rounded-lg border border-line bg-white p-4 text-[12px] text-ink-muted">If you confirm delivery yourself, earnings are held longer than when the buyer, a carrier scan or rider proof confirms it.</p>}
          {vo.shipments.map((s) => <section key={s.id} className="rounded-lg border border-line bg-white p-4 text-sm"><h2 className="mb-1 font-semibold">Shipment</h2><p>{s.carrier}{s.trackingNumber ? ` · ${s.trackingNumber}` : ""}</p><StatusBadge status={s.status} /></section>)}
        </aside>
      </div>
    </>
  );
}
