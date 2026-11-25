import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { payOrderAction } from "@/app/actions/checkout";
import { OrderDetail, PaymentBanner, orderInclude } from "@/components/order-summary";
import { Alert, StatusBadge } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { ButtonLink } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/form";
import { confirmReceiptAction, customerDisputeReplyAction, openDisputeAction } from "@/app/actions/disputes";
import { DISPUTE_REASONS } from "@/server/services/disputes";
import type { OrderFull } from "@/components/order-summary";

export const metadata = { title: "Order details", robots: { index: false } };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ payment?: string; error?: string; notice?: string }> }) {
  const { number } = await params;
  const sp = await searchParams;
  const u = await requireUser(`/account/orders/${number}`);
  const order = await db.order.findUnique({ where: { number }, include: orderInclude });
  if (!order || order.userId !== u.id) notFound(); // never reveal other customers' orders
  return (
    <>
      <PaymentBanner outcome={sp.payment} />
      {sp.error && <Alert tone="danger" className="mb-6">{sp.error}</Alert>}
      {sp.notice && <Alert tone="success" className="mb-6">{sp.notice}</Alert>}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3"><h1 className="text-2xl font-semibold">Order {order.number}</h1><StatusBadge status={order.status} /></div>
          <p className="mt-1 text-sm text-ink-muted">Placed {order.createdAt.toLocaleString("en-NG", { dateStyle: "long", timeStyle: "short" })} · {order.vendorOrders.length} {order.vendorOrders.length === 1 ? "shipment" : "shipments"}</p>
        </div>
        <div className="flex gap-2">
          {order.paymentStatus === "UNPAID" && order.status === "PENDING_PAYMENT" && (
            <form action={payOrderAction}><input type="hidden" name="number" value={order.number} /><SubmitButton>Complete payment</SubmitButton></form>
          )}
          {order.paymentStatus === "PAID" && <ButtonLink href={`/account/support?order=${order.number}`} variant="secondary">Get help with this order</ButtonLink>}
        </div>
      </div>
      <OrderDetail order={order} renderActions={(vo) => <BuyerProtection vo={vo} />} renderHeaderAction={(vo) => order.paymentStatus !== "UNPAID" ? <a href={`/messages/start?vendor=${vo.vendorId}&order=${order.number}`} className="text-[13px] font-medium text-brand hover:underline">Message seller</a> : null} />
    </>
  );
}

const OPEN = ["OPEN", "AWAITING_VENDOR", "UNDER_REVIEW"];
const DISPUTE_TEXT: Record<string, string> = { OPEN: "Open", AWAITING_VENDOR: "Waiting for the seller's response", UNDER_REVIEW: "Being reviewed by XavierConnect", RESOLVED_CUSTOMER: "Decided in your favour — refund issued", RESOLVED_VENDOR: "Decided in the seller's favour", CLOSED: "Closed" };

function BuyerProtection({ vo }: { vo: OrderFull["vendorOrders"][number] }) {
  const dispute = vo.disputes[0];
  const canConfirm = ["SHIPPED", "DELIVERED"].includes(vo.status) && vo.deliveryEvidence !== "CUSTOMER_CONFIRMED" && !vo.settledAt;
  const canDispute = !vo.settledAt && !["AWAITING_PAYMENT", "CANCELLED", "REFUNDED"].includes(vo.status) && !(dispute && OPEN.includes(dispute.status));
  if (!dispute && !canConfirm && !canDispute) return null;
  return (
    <div className="space-y-3 border-t border-line px-4 py-3 text-[13px]">
      {dispute && (
        <div className="rounded-md bg-canvas p-3">
          <p className="font-medium">Problem reported: {dispute.reason} · {DISPUTE_TEXT[dispute.status] ?? dispute.status}</p>
          <ol className="mt-2 space-y-1.5">{dispute.evidence.map((e) => <li key={e.id}><span className="text-ink-muted">{e.party === "CUSTOMER" ? "You" : e.party === "VENDOR" ? "Seller" : "XavierConnect"} · {e.createdAt.toLocaleDateString("en-NG")}:</span> {e.body}</li>)}</ol>
          {OPEN.includes(dispute.status) && <form action={customerDisputeReplyAction} className="mt-2 flex gap-2"><input type="hidden" name="disputeId" value={dispute.id} /><Textarea name="body" rows={2} placeholder="Add information or evidence (e.g. what arrived, photos sent by email to support)" className="flex-1" required minLength={5} /><SubmitButton size="sm" variant="secondary">Send</SubmitButton></form>}
        </div>
      )}
      {canConfirm && (
        <form action={confirmReceiptAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="vendorOrderId" value={vo.id} />
          <SubmitButton size="sm" confirm="Confirm you received everything in this shipment in good condition?">I received this</SubmitButton>
          <span className="text-ink-muted">Confirming lets the seller be paid sooner. Only confirm once you have the items.</span>
        </form>
      )}
      {canDispute && (
        <details>
          <summary className="cursor-pointer text-brand">Report a problem with this shipment</summary>
          <form action={openDisputeAction} className="mt-2 space-y-2">
            <input type="hidden" name="vendorOrderId" value={vo.id} />
            <Select name="reason" required defaultValue=""><option value="" disabled>Choose a reason</option>{DISPUTE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
            <Textarea name="description" rows={3} minLength={20} required placeholder="Describe what happened (at least 20 characters)" />
            <p className="text-[12px] text-ink-muted">While a problem is open, the seller is not paid for this shipment. XavierConnect reviews both sides and may refund you.</p>
            <SubmitButton size="sm" variant="secondary">Report problem</SubmitButton>
          </form>
        </details>
      )}
    </div>
  );
}
