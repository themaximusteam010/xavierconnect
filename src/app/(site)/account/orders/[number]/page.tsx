import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { payOrderAction } from "@/app/actions/checkout";
import { OrderDetail, PaymentBanner, orderInclude } from "@/components/order-summary";
import { Alert, StatusBadge } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "Order details", robots: { index: false } };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ payment?: string; error?: string }> }) {
  const { number } = await params;
  const sp = await searchParams;
  const u = await requireUser(`/account/orders/${number}`);
  const order = await db.order.findUnique({ where: { number }, include: orderInclude });
  if (!order || order.userId !== u.id) notFound(); // never reveal other customers' orders
  return (
    <>
      <PaymentBanner outcome={sp.payment} />
      {sp.error && <Alert tone="danger" className="mb-6">{sp.error}</Alert>}
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
      <OrderDetail order={order} />
    </>
  );
}
