import Link from "next/link";
import { Truck } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { shippingProviderName, STATUS_LABEL } from "@/server/services/shipping";
import { CONSOLIDATION_LABEL } from "@/server/services/freight";
import { RETURN_REASONS } from "@/server/services/shipping-returns";
import { getSetting } from "@/server/services/settings";
import { requestReturnAction, returnShippedAction } from "@/app/actions/shipping-ops";
import { PageHeader } from "@/components/ui/page-header";
import { Alert, EmptyState, FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ButtonLink } from "@/components/ui/button";
import { countryName } from "@/lib/countries";

export const metadata = { title: "Shipping and tracking" };
const LEG: Record<string, string> = { DIRECT: "Delivery", TO_WAREHOUSE: "Seller → consolidation warehouse", CONSOLIDATED: "International freight", LAST_MILE: "Final delivery in Nigeria", RETURN: "Your return to the seller" };
const OPEN_RETURN = ["REQUESTED", "APPROVED", "IN_TRANSIT", "RECEIVED"];
const d = (x: Date) => x.toLocaleDateString("en-NG", { dateStyle: "medium" });

export default async function AccountShipments({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser("/account/shipments");
  const sp = await searchParams;
  const [orders, windowDays] = await Promise.all([
    db.order.findMany({
      where: { userId: user.id, paymentStatus: "PAID", vendorOrders: { some: { items: { some: { kind: "PHYSICAL" } } } } },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        vendorOrders: {
          where: { items: { some: { kind: "PHYSICAL" } } },
          include: {
            vendor: { select: { businessName: true, country: true } },
            items: { where: { kind: "PHYSICAL" }, select: { id: true, name: true, quantity: true } },
            shipments: { orderBy: { createdAt: "asc" }, include: { events: { orderBy: { createdAt: "desc" }, take: 8 }, consolidation: { select: { status: true, mode: true, eta: true, events: { orderBy: { createdAt: "asc" }, select: { id: true, status: true, createdAt: true } } } } } },
            shippingReturns: { orderBy: { createdAt: "desc" } },
          },
        },
      },
    }),
    getSetting(db, "returnWindowDays"),
  ]);
  return (
    <>
      <PageHeader title="Shipping and tracking" description="Each seller ships separately, so one order can arrive in several parcels on different days." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      {orders.length === 0 ? <EmptyState icon={Truck} title="Nothing to track yet" action={<ButtonLink href="/shop">Start shopping</ButtonLink>}>Paid orders with physical items appear here.</EmptyState> : (
        <div className="space-y-6">
          {orders.map((o) => (
            <section key={o.id} className="rounded-lg border border-line bg-white">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <p className="font-semibold">Order {o.number} <span className="text-[13px] font-normal text-ink-muted">· {d(o.createdAt)}</span></p>
                <Link href={`/account/orders/${o.number}`} className="text-[13px] text-brand">Order details · report a problem</Link>
              </header>
              <div className="divide-y divide-line">
                {o.vendorOrders.map((vo) => {
                  const open = vo.shippingReturns.find((r) => OPEN_RETURN.includes(r.status));
                  const canReturn = vo.status === "DELIVERED" && vo.deliveredAt && !vo.settledAt && !open && Date.now() - vo.deliveredAt.getTime() <= windowDays * 864e5;
                  return (
                    <div key={vo.id} className="space-y-3 px-4 py-4 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p><span className="font-medium">{vo.vendor.businessName}</span> <span className="text-ink-muted">· {vo.number}{vo.vendor.country !== "NG" && ` · ships from ${countryName(vo.vendor.country)}`}</span></p>
                        <StatusBadge status={vo.status} />
                      </div>
                      <p className="text-[12px] text-ink-muted">{vo.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</p>
                      {vo.shipments.length === 0 && <p className="text-ink-muted">The seller hasn&apos;t shipped this yet. You&apos;ll get a notification with tracking when they do.</p>}
                      {vo.shipments.map((s) => (
                        <div key={s.id} className="rounded-md border border-line p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium">{LEG[s.leg] ?? "Delivery"}</p>
                            <StatusBadge status={s.status} />
                          </div>
                          <p className="mt-1">{s.carrier}{s.providerKey && <span className="text-ink-muted"> · via {shippingProviderName(s.providerKey)}</span>}</p>
                          {s.trackingNumber && <p className="font-mono text-[12px]">Tracking: {s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-brand underline">{s.trackingNumber}</a> : s.trackingNumber}</p>}
                          {s.estimatedDeliveryAt && !["DELIVERED", "CANCELLED"].includes(s.status) && <p className="text-[12px]">Carrier&apos;s estimated delivery: {d(s.estimatedDeliveryAt)}</p>}
                          {s.status === "CUSTOMS_PROCESSING" && <p className="text-[12px] text-warning">In Nigerian customs. Import duty and VAT are set by the Nigeria Customs Service; if any are payable by you, the carrier or support will contact you with the official amount.</p>}
                          {s.consolidation && (
                            <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                              {s.consolidation.events.map((e) => <li key={e.id} className="text-ink-2">✓ {CONSOLIDATION_LABEL[e.status] ?? e.status} <span className="text-ink-muted">{d(e.createdAt)}</span></li>)}
                              {s.consolidation.eta && !["CLOSED", "CANCELLED"].includes(s.consolidation.status) && <li className="text-ink-muted">Partner&apos;s arrival estimate: {d(s.consolidation.eta)} ({s.consolidation.mode.toLowerCase()} freight)</li>}
                            </ol>
                          )}
                          {s.events.length > 0 && (
                            <details className="mt-2 text-[12px]">
                              <summary className="cursor-pointer text-brand">Tracking history</summary>
                              <ol className="mt-1 space-y-0.5 border-l border-line pl-3">{s.events.map((e) => <li key={e.id}><span className="text-ink-muted">{e.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</span> · {STATUS_LABEL[e.status]}{e.note && ` — ${e.note}`}{e.location && ` (${e.location})`}</li>)}</ol>
                            </details>
                          )}
                          {s.status === "FAILED_ATTEMPT" && <p className="mt-1 text-[12px] text-danger">Delivery attempt failed. Message the seller or contact the carrier with the tracking number to rearrange.</p>}
                        </div>
                      ))}
                      {vo.shippingReturns.map((r) => (
                        <div key={r.id} className="rounded-md bg-canvas p-3">
                          <p className="font-medium">Return: {r.reason} <StatusBadge status={r.status} /></p>
                          {r.decisionNote && <p className="mt-1 whitespace-pre-line text-[13px]">Seller: {r.decisionNote}</p>}
                          {r.status === "APPROVED" && (
                            <form action={returnShippedAction} className="mt-2 flex flex-wrap items-end gap-2">
                              <input type="hidden" name="id" value={r.id} />
                              <label className="text-[12px]">Courier<Input name="carrier" required className="h-9 w-40" /></label>
                              <label className="text-[12px]">Tracking number<Input name="tracking" required className="h-9 w-44" /></label>
                              <SubmitButton size="sm">I&apos;ve sent it back</SubmitButton>
                            </form>
                          )}
                          {r.status === "REJECTED" && <p className="mt-1 text-[12px]">You can still <Link href={`/account/orders/${o.number}`} className="text-brand underline">open a dispute</Link> from the order page.</p>}
                        </div>
                      ))}
                      {canReturn && (
                        <details className="text-[13px]">
                          <summary className="cursor-pointer text-brand">Request a return (within {windowDays} days of delivery)</summary>
                          <form action={requestReturnAction} className="mt-2 max-w-md space-y-2">
                            <input type="hidden" name="vendorOrderId" value={vo.id} />
                            <Select name="reason" required>{RETURN_REASONS.map((x) => <option key={x}>{x}</option>)}</Select>
                            <Textarea name="details" rows={3} placeholder="What's wrong? Photos can be sent to the seller in Messages." />
                            <SubmitButton size="sm" variant="secondary">Request return</SubmitButton>
                          </form>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          <Alert>Delivery dates come from the carrier or freight partner. XavierConnect doesn&apos;t estimate them itself.</Alert>
        </div>
      )}
    </>
  );
}
