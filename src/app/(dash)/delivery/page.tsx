import { Truck } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { deliveryUpdateAction } from "@/app/actions/delivery";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata = { title: "My deliveries" };

export default async function Deliveries({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const u = await requireUser("/delivery");
  const sp = await searchParams;
  const list = await db.shipment.findMany({ where: { deliveryPartnerId: u.id, status: { notIn: ["DELIVERED", "RETURNED"] } }, orderBy: { createdAt: "asc" }, include: { vendorOrder: { include: { vendor: { include: { store: true } }, order: { select: { shippingAddress: true } }, items: { select: { name: true, quantity: true } } } } } });
  return (
    <>
      <PageHeader title="Assigned deliveries" />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      {list.length === 0 ? <EmptyState icon={Truck} title="Nothing assigned right now" /> : (
        <ul className="space-y-4">
          {list.map((s) => {
            const a = s.vendorOrder.order.shippingAddress as { fullName: string; phone: string; line1: string; line2?: string; city: string; state: string } | null;
            return (
              <li key={s.id} className="rounded-lg border border-line bg-white p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{s.vendorOrder.number}</p><StatusBadge status={s.status} /></div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div><p className="eyebrow mb-1">Pick up from</p><p>{s.vendorOrder.vendor.store?.name}</p><p className="text-ink-muted">{s.vendorOrder.vendor.addressLine1}, {s.vendorOrder.vendor.city}, {s.vendorOrder.vendor.state}</p><p className="text-ink-muted">{s.vendorOrder.vendor.phone}</p></div>
                  {a && <div><p className="eyebrow mb-1">Deliver to</p><p>{a.fullName}</p><p className="text-ink-muted">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state}</p><a href={`tel:${a.phone}`} className="text-brand">{a.phone}</a></div>}
                </div>
                <p className="mt-3 text-ink-muted">{s.vendorOrder.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</p>
                <form action={deliveryUpdateAction} className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                  <input type="hidden" name="id" value={s.id} />
                  <Select name="status" defaultValue="IN_TRANSIT" className="h-9 w-48" aria-label="New status"><option value="PICKED_UP">Picked up</option><option value="IN_TRANSIT">In transit</option><option value="OUT_FOR_DELIVERY">Out for delivery</option><option value="DELIVERED">Delivered</option><option value="FAILED_ATTEMPT">Delivery attempt failed</option></Select>
                  <Input name="recipient" placeholder="Received by (for delivered)" className="h-9 w-52" />
                  <Input name="note" placeholder="Note (e.g. reason for failed attempt)" className="h-9 w-64" />
                  <SubmitButton size="sm" className="h-9">Update</SubmitButton>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
