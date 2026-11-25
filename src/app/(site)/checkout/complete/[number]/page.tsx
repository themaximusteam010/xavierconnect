import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { verifySigned } from "@/server/auth/tokens";
import { OrderDetail, PaymentBanner, orderInclude } from "@/components/order-summary";
import { StatusBadge } from "@/components/ui/feedback";

export const metadata = { title: "Order receipt", robots: { index: false } };

/** Guest receipt. Access requires the signed token issued at payment callback. */
export default async function GuestComplete({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ t?: string; payment?: string }> }) {
  const { number } = await params;
  const sp = await searchParams;
  if (!sp.t || verifySigned(sp.t) !== `receipt:${number}`) notFound();
  const order = await db.order.findUnique({ where: { number }, include: orderInclude });
  if (!order || order.userId) notFound();
  return (
    <div className="container-x py-10">
      <PaymentBanner outcome={sp.payment} />
      <div className="mb-6 flex items-center gap-3"><h1 className="text-2xl font-semibold">Order {order.number}</h1><StatusBadge status={order.status} /></div>
      <p className="mb-6 text-sm text-ink-muted">A receipt has been sent to {order.guestEmail}. Bookmark this page to follow your order; the link works for 7 days.</p>
      <OrderDetail order={order} downloads={false} />
    </div>
  );
}
