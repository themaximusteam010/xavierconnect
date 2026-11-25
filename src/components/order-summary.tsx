import Link from "next/link";
import { Download } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { StatusBadge, Alert } from "@/components/ui/feedback";
import { formatMoney } from "@/lib/money";

export const orderInclude = {
  vendorOrders: {
    orderBy: { number: "asc" },
    include: {
      vendor: { include: { store: true } },
      items: { include: { product: { select: { slug: true } }, downloadGrants: { select: { id: true, expiresAt: true, downloadsUsed: true, maxDownloads: true, revokedAt: true, asset: { select: { fileName: true } } } } } },
      shipments: { include: { events: { orderBy: { createdAt: "asc" } }, customs: { select: { incoterm: true } } } },
      events: { orderBy: { createdAt: "asc" } },
      disputes: { orderBy: { createdAt: "desc" }, include: { evidence: { orderBy: { createdAt: "asc" } } } },
    },
  },
} satisfies Prisma.OrderInclude;
export type OrderFull = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function PaymentBanner({ outcome }: { outcome?: string }) {
  if (outcome === "paid" || outcome === "already_paid") return <Alert tone="success" title="Payment confirmed" className="mb-6">Thank you. Every seller in this order has been notified.</Alert>;
  if (outcome === "failed") return <Alert tone="danger" title="Payment was not completed" className="mb-6">You have not been charged. Your items stay reserved for a short while — you can try again below.</Alert>;
  if (outcome === "pending") return <Alert tone="warning" title="Waiting for confirmation" className="mb-6">We have not received confirmation from the payment provider yet. Refresh in a minute.</Alert>;
  if (outcome === "needs_review") return <Alert tone="warning" title="We are checking your payment" className="mb-6">Our team will review this payment and contact you. If you were charged and the order cannot be fulfilled, you will be refunded.</Alert>;
  return null;
}

export function OrderDetail({ order, downloads = true, renderActions }: { order: OrderFull; downloads?: boolean; renderActions?: (vo: OrderFull["vendorOrders"][number]) => React.ReactNode }) {
  const addr = order.shippingAddress as { fullName: string; phone: string; line1: string; line2?: string; city: string; state: string } | null;
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <div className="space-y-5">
        {order.vendorOrders.map((vo) => (
          <section key={vo.id} className="rounded-lg border border-line">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas px-4 py-3 text-sm">
              <div><span className="font-medium">{vo.vendor.store?.name}</span><span className="ml-2 text-ink-muted">Shipment {vo.number}</span></div>
              <StatusBadge status={vo.status} />
            </header>
            <ul className="divide-y divide-line">
              {vo.items.map((it) => (
                <li key={it.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    {it.product ? <Link href={`/p/${it.product.slug}`} className="font-medium hover:text-brand">{it.name}</Link> : <span className="font-medium">{it.name}</span>}
                    <p className="tabular text-[13px] text-ink-muted">{it.quantity} × {formatMoney(it.unitPriceMinor)}</p>
                    {downloads && it.downloadGrants.map((g) => (
                      g.revokedAt ? <p key={g.id} className="mt-1 text-[13px] text-ink-muted">Download revoked</p> :
                      <a key={g.id} href={`/download/${g.id}`} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"><Download className="size-3.5" />{g.asset.fileName} ({g.maxDownloads - g.downloadsUsed} left)</a>
                    ))}
                  </div>
                  <span className="tabular font-medium">{formatMoney(it.lineTotalMinor)}</span>
                </li>
              ))}
            </ul>
            {(vo.shipments.length > 0 || vo.events.length > 0) && (
              <ol className="space-y-1.5 border-t border-line px-4 py-3 text-[13px] text-ink-muted">
                {vo.shipments.map((s) => (s.trackingNumber || s.international) && (
                  <li key={s.id}>
                    Carrier {s.carrier}{s.trackingNumber && <> · Tracking {s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline">{s.trackingNumber}</a> : <span className="font-medium text-ink">{s.trackingNumber}</span>}</>}
                    {s.international && <span className="mt-1 block rounded bg-warning-soft px-2 py-1 text-warning">International shipment{s.originCountry ? ` from ${s.originCountry}` : ""}. {s.customs?.incoterm === "DDP" ? "Import duties have been prepaid by the seller." : "Import duties and taxes may be charged by Nigeria Customs or the carrier on arrival."}</span>}
                    {s.events.length > 1 && <span className="block">Latest: {s.events[s.events.length - 1].status.replace(/_/g, " ").toLowerCase()}{s.events[s.events.length - 1].location ? ` · ${s.events[s.events.length - 1].location}` : ""}</span>}
                  </li>
                ))}
                {vo.events.map((e) => <li key={e.id}><span className="tabular">{e.createdAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</span> — {e.status.replace(/_/g, " ").toLowerCase()}{e.note ? `: ${e.note}` : ""}</li>)}
              </ol>
            )}
            {renderActions?.(vo)}
          </section>
        ))}
      </div>
      <aside className="space-y-4">
        <div className="rounded-lg border border-line p-4">
          <dl className="tabular space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-ink-muted">Items</dt><dd>{formatMoney(order.subtotalMinor)}</dd></div>
            {order.discountMinor > 0n && <div className="flex justify-between text-success"><dt>Discount</dt><dd>−{formatMoney(order.discountMinor)}</dd></div>}
            <div className="flex justify-between"><dt className="text-ink-muted">Delivery</dt><dd>{formatMoney(order.shippingMinor)}</dd></div>
            {order.taxMinor > 0n && <div className="flex justify-between"><dt className="text-ink-muted">VAT</dt><dd>{formatMoney(order.taxMinor)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Total</dt><dd>{formatMoney(order.totalMinor)}</dd></div>
          </dl>
        </div>
        {addr && (
          <div className="rounded-lg border border-line p-4 text-sm">
            <p className="eyebrow mb-2">Delivering to</p>
            <p className="font-medium">{addr.fullName}</p>
            <p className="text-ink-2">{addr.line1}{addr.line2 ? `, ${addr.line2}` : ""}</p>
            <p className="text-ink-2">{addr.city}, {addr.state}</p>
            <p className="text-ink-muted">{addr.phone}</p>
          </div>
        )}
      </aside>
    </div>
  );
}
