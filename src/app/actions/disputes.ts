"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { requireUser, requireVendor } from "@/server/auth/session";
import { addEvidence, confirmReceipt, DisputeError, openDispute } from "@/server/services/disputes";
import { rateLimit } from "@/server/rate-limit";

const back = (path: string, k: "ok" | "error", m: string) => (revalidatePath(path), redirect(`${path}?${k === "ok" ? "notice" : "error"}=${encodeURIComponent(m)}`));

async function orderPath(customerId: string, vendorOrderId: string) {
  const vo = await db.vendorOrder.findFirst({ where: { id: vendorOrderId, order: { userId: customerId } }, select: { order: { select: { number: true } } } });
  return vo ? `/account/orders/${vo.order.number}` : "/account/orders";
}

export async function confirmReceiptAction(fd: FormData) {
  const u = await requireUser();
  const id = String(fd.get("vendorOrderId"));
  const path = await orderPath(u.id, id);
  try { await confirmReceipt(u.id, id); } catch (e) { if (e instanceof DisputeError) back(path, "error", e.message); throw e; }
  back(path, "ok", "Thanks — receipt confirmed.");
}

export async function openDisputeAction(fd: FormData) {
  const u = await requireUser();
  const id = String(fd.get("vendorOrderId"));
  const path = await orderPath(u.id, id);
  if (!(await rateLimit("dispute.open", 5, 3600, u.id))) back(path, "error", "Too many requests. Try again later.");
  try { await openDispute(u.id, id, String(fd.get("reason") ?? ""), String(fd.get("description") ?? "")); } catch (e) { if (e instanceof DisputeError) back(path, "error", e.message); throw e; }
  back(path, "ok", "Problem reported. The seller has 3 days to respond and their payment for this order is on hold.");
}

export async function customerDisputeReplyAction(fd: FormData) {
  const u = await requireUser();
  const id = String(fd.get("disputeId"));
  const d = await db.dispute.findFirst({ where: { id, openedById: u.id }, select: { order: { select: { number: true } } } });
  const path = d ? `/account/orders/${d.order.number}` : "/account/orders";
  try { await addEvidence(id, u.id, "CUSTOMER", String(fd.get("body") ?? ""), { customerId: u.id }); } catch (e) { if (e instanceof DisputeError) back(path, "error", e.message); throw e; }
  back(path, "ok", "Message added to the dispute.");
}

export async function vendorDisputeReplyAction(fd: FormData) {
  const { vendorId, user } = await requireVendor("orders");
  const id = String(fd.get("disputeId"));
  const d = await db.dispute.findFirst({ where: { id, vendorOrder: { vendorId } }, select: { vendorOrderId: true } });
  const path = d ? `/vendor/orders/${d.vendorOrderId}` : "/vendor/orders";
  try { await addEvidence(id, user.id, "VENDOR", String(fd.get("body") ?? ""), { vendorId }); } catch (e) { if (e instanceof DisputeError) redirect(`${path}?error=${encodeURIComponent(e.message)}`); throw e; }
  revalidatePath(path);
  redirect(`${path}?ok=${encodeURIComponent("Response sent. Our team will review both sides.")}`);
}
