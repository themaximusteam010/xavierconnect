"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { updateVendorOrderStatus } from "@/server/services/orders";

/** Delivery partners update only shipments assigned to them. */
export async function deliveryUpdateAction(fd: FormData) {
  const u = await requirePermission("delivery.perform");
  const id = String(fd.get("id"));
  const status = z.enum(["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_ATTEMPT"]).parse(fd.get("status"));
  const note = String(fd.get("note") ?? "").slice(0, 300) || null;
  const recipient = String(fd.get("recipient") ?? "").trim().slice(0, 100) || null;
  const s = await db.shipment.findFirst({ where: { id, deliveryPartnerId: u.id }, include: { vendorOrder: true } });
  if (!s) redirect("/delivery?error=Shipment+not+assigned+to+you");
  if (status === "DELIVERED" && !recipient) redirect("/delivery?error=Enter+who+received+the+package");
  await db.$transaction([
    db.shipment.update({ where: { id }, data: { status, recipientName: recipient ?? undefined } }),
    db.shipmentEvent.create({ data: { shipmentId: id, status, note: status === "DELIVERED" ? `Received by ${recipient}${note ? ` — ${note}` : ""}` : note } }),
  ]);
  if (status === "DELIVERED" && s!.vendorOrder.status === "SHIPPED") {
    await updateVendorOrderStatus(s!.vendorOrder.vendorId, s!.vendorOrderId, "DELIVERED", u.id, { note: `Proof of delivery: received by ${recipient}`, evidence: "RIDER_POD" });
  }
  redirect("/delivery?ok=Updated");
}
