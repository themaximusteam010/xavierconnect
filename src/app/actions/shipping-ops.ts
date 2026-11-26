"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { requirePermission, requireUser, requireVendor } from "@/server/auth/session";
import { shippingAdapter } from "@/server/integrations/registry";
import { audit } from "@/server/services/audit";
import { cancelShipment, refreshTracking, schedulePickup, ShippingError } from "@/server/services/shipping";
import { addShippingInvoice, addToConsolidation, advanceConsolidation, confirmFinalDelivery, createConsolidation, dispatchLastMile, FreightError, markReceiptException, receiveParcel, recordPartnerQuote, registerInbound, saveWarehouse, type ConsolidationStatus } from "@/server/services/freight";
import { decideReturn, markReturnShipped, receiveReturnAndRefund, requestReturn, ReturnError } from "@/server/services/shipping-returns";
import { FinanceError } from "@/server/services/finance";
import { parseNairaToMinor } from "@/lib/money";
import { NIGERIAN_STATES } from "@/lib/validation";

const go = (path: string, k: "ok" | "error", m: string) => { revalidatePath(path.split("?")[0]); redirect(`${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`); };
async function run(path: string, fn: () => Promise<unknown>, ok: string | ((r: unknown) => string)) {
  let r: unknown;
  try { r = await fn(); } catch (e) { if (e instanceof ShippingError || e instanceof FreightError || e instanceof ReturnError || e instanceof FinanceError) go(path, "error", e.message); throw e; }
  go(path, "ok", typeof ok === "function" ? ok(r) : ok);
}
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const int = (fd: FormData, k: string) => Math.round(Number(fd.get(k)));

// ─── Admin: provider shipping settings, zones ────────────────────────────────

export async function saveShippingProviderSettingsAction(fd: FormData) {
  const u = await requirePermission("integrations.manage");
  const key = str(fd, "key");
  const back = "/admin/integrations/shipping";
  const a = shippingAdapter(key);
  if (!a) go(back, "error", "Unknown provider.");
  const priority = int(fd, "priority");
  const minKg = str(fd, "minKg"), maxKg = str(fd, "maxKg");
  const markupPct = str(fd, "markupPct");
  const markupFixed = str(fd, "markupFixed") ? parseNairaToMinor(str(fd, "markupFixed")) : 0n;
  if (!(priority >= 1 && priority <= 999)) go(back, "error", "Priority must be 1–999.");
  if (markupFixed == null || markupFixed < 0n) go(back, "error", "Fixed markup must be a naira amount.");
  const bps = markupPct ? Math.round(Number(markupPct) * 100) : 0;
  if (!(bps >= 0 && bps <= 5000)) go(back, "error", "Markup must be 0–50%.");
  const kgToG = (v: string) => (v ? Math.round(Number(v) * 1000) : null);
  const minW = kgToG(minKg), maxW = kgToG(maxKg);
  if ((minW != null && !(minW >= 0)) || (maxW != null && !(maxW > 0)) || (minW != null && maxW != null && minW > maxW)) go(back, "error", "Check the weight limits.");
  const zones = fd.getAll("zones").map(String);
  const valid = zones.length ? (await db.shippingZone.findMany({ where: { id: { in: zones } }, select: { id: true } })).map((z) => z.id) : [];
  const isDefault = fd.get("isDefault") === "on";
  const before = await db.integrationProvider.findUnique({ where: { key } });
  if (!before) go(back, "error", "Save the provider's main settings first.");
  await db.$transaction([
    ...(isDefault ? [db.integrationProvider.updateMany({ where: { kind: "SHIPPING", key: { not: key } }, data: { isDefault: false } })] : []),
    db.integrationProvider.update({ where: { key }, data: { priority, isDefault, minWeightGrams: minW, maxWeightGrams: maxW, feeBps: bps, feeFixedMinor: markupFixed!, zones: valid, category: a!.profile.category } }),
  ]);
  await audit(db, { actorId: u.id, action: "shipping.provider.settings", entityType: "IntegrationProvider", entityId: key, before: { priority: before!.priority, feeBps: before!.feeBps, feeFixedMinor: before!.feeFixedMinor.toString(), zones: before!.zones }, after: { priority, isDefault, minW, maxW, bps, markupFixed: markupFixed!.toString(), zones: valid } });
  go(back, "ok", `${a!.name} shipping settings saved.`);
}

export async function saveShippingZoneAction(fd: FormData) {
  const u = await requirePermission("integrations.manage");
  const back = "/admin/integrations/shipping?tab=zones";
  const name = str(fd, "name");
  const regions = fd.getAll("regions").map(String).filter((r) => (NIGERIAN_STATES as readonly string[]).includes(r));
  if (name.length < 2) go(back, "error", "Name the zone.");
  if (!regions.length) go(back, "error", "Choose at least one state.");
  const id = str(fd, "id");
  const z = id ? await db.shippingZone.update({ where: { id }, data: { name, regions, active: fd.get("active") === "on" } }) : await db.shippingZone.create({ data: { name, country: "NG", regions } });
  await audit(db, { actorId: u.id, action: id ? "shipping.zone.update" : "shipping.zone.create", entityType: "ShippingZone", entityId: z.id, after: { name, regions } });
  go(back, "ok", "Zone saved.");
}

// ─── Shipments: admin + vendor ───────────────────────────────────────────────

export async function adminCancelShipmentAction(fd: FormData) {
  const u = await requirePermission("order.manage");
  const id = str(fd, "id");
  await run(`/admin/shipments?id=${id}`, () => cancelShipment({ id: u.id, staff: true }, id, str(fd, "reason")), "Shipment cancelled.");
}
export async function adminRefreshTrackingAction(fd: FormData) {
  await requirePermission("order.view_all");
  const id = str(fd, "id");
  await run(`/admin/shipments?id=${id}`, () => refreshTracking(id), (x) => {
    const r = x as Awaited<ReturnType<typeof refreshTracking>>;
    return `Tracking refreshed: ${r.added} new event(s)${r.status ? `, status ${r.status.toLowerCase().replace(/_/g, " ")}` : r.rawStatus ? ` (carrier status “${r.rawStatus}” not mapped — no change)` : ""}.`;
  });
}
export async function vendorCancelShipmentAction(fd: FormData) {
  const { vendorId, user } = await requireVendor("orders");
  const id = str(fd, "id");
  await run("/vendor/shipments", () => cancelShipment({ id: user.id, vendorId }, id, str(fd, "reason")), "Shipment cancelled. The order is back to processing.");
}
export async function vendorPickupAction(fd: FormData) {
  const { vendorId, user } = await requireVendor("orders");
  await run("/vendor/shipments", () => schedulePickup(vendorId, str(fd, "id"), str(fd, "date"), user.id), "Pickup recorded.");
}
export async function vendorRefreshTrackingAction(fd: FormData) {
  const { vendorId } = await requireVendor("orders");
  const id = str(fd, "id");
  const own = await db.shipment.findFirst({ where: { id, vendorOrder: { vendorId } } });
  if (!own) go("/vendor/shipments", "error", "Shipment not found.");
  await run("/vendor/shipments", () => refreshTracking(id), "Tracking refreshed.");
}

// ─── Freight ─────────────────────────────────────────────────────────────────

export async function saveWarehouseAction(fd: FormData) {
  const u = await requirePermission("order.manage");
  await run("/admin/freight?tab=warehouses", () => saveWarehouse(u.id, {
    id: str(fd, "id") || undefined, code: str(fd, "code").toUpperCase(), name: str(fd, "name"), country: str(fd, "country").toUpperCase(), city: str(fd, "city"), address: str(fd, "address"),
    contactName: str(fd, "contactName"), phone: str(fd, "phone"), partnerKey: str(fd, "partnerKey"), role: str(fd, "role") === "DESTINATION" ? "DESTINATION" : "ORIGIN", active: fd.get("active") === "on", notes: str(fd, "notes"),
  }), "Warehouse saved.");
}
export async function receiveParcelAction(fd: FormData) {
  const u = await requirePermission("order.manage");
  await run("/admin/freight?tab=receiving", () => receiveParcel(u.id, str(fd, "id"), { weightGrams: Math.round(Number(fd.get("weightKg")) * 1000), lengthCm: int(fd, "lengthCm"), widthCm: int(fd, "widthCm"), heightCm: int(fd, "heightCm"), pieces: int(fd, "pieces") || 1 }), "Parcel received.");
}
export async function receiptExceptionAction(fd: FormData) {
  const u = await requirePermission("order.manage");
  await run("/admin/freight?tab=receiving", () => markReceiptException(u.id, str(fd, "id"), str(fd, "note")), "Exception recorded.");
}
export async function createConsolidationAction(fd: FormData) {
  const u = await requirePermission("order.manage");
  await run("/admin/freight?tab=consolidations", () => createConsolidation(u.id, { mode: str(fd, "mode") === "SEA" ? "SEA" : "AIR", partnerKey: str(fd, "partnerKey"), originWarehouseId: str(fd, "warehouseId") }), "Consolidation opened.");
}
export async function addToConsolidationAction(fd: FormData) {
  const u = await requirePermission("order.manage");
  const id = str(fd, "id");
  await run(`/admin/freight?tab=consolidations&id=${id}`, () => addToConsolidation(u.id, id, fd.getAll("receipts").map(String)), "Parcels added.");
}
export async function partnerQuoteAction(fd: FormData) {
  const u = await requirePermission("finance.view");
  const id = str(fd, "id");
  const amount = parseNairaToMinor(str(fd, "amount"));
  await run(`/admin/freight?tab=consolidations&id=${id}`, () => recordPartnerQuote(u.id, id, { costMinor: amount ?? 0n, currency: str(fd, "currency").toUpperCase(), includes: str(fd, "includes"), excludes: str(fd, "excludes") }), "Partner quote recorded.");
}
export async function advanceConsolidationAction(fd: FormData) {
  const u = await requirePermission("order.manage");
  const id = str(fd, "id");
  const date = (k: string) => (str(fd, k) ? new Date(str(fd, k)) : undefined);
  await run(`/admin/freight?tab=consolidations&id=${id}`, () => advanceConsolidation(u.id, id, str(fd, "to") as ConsolidationStatus, { note: str(fd, "note"), location: str(fd, "location"), partnerReference: str(fd, "partnerReference") || undefined, etd: date("etd"), eta: date("eta") }), "Consolidation updated; customers notified where relevant.");
}
export async function dispatchLastMileAction(fd: FormData) {
  const u = await requirePermission("order.manage");
  await run(`/admin/freight?tab=lastmile`, () => dispatchLastMile(u.id, str(fd, "id"), { carrier: str(fd, "carrier"), trackingNumber: str(fd, "trackingNumber"), trackingUrl: str(fd, "trackingUrl") }), "Dispatched for last-mile delivery.");
}
export async function confirmFinalDeliveryAction(fd: FormData) {
  const u = await requirePermission("order.manage");
  await run(`/admin/freight?tab=lastmile`, () => confirmFinalDelivery(u.id, str(fd, "id"), str(fd, "recipient")), "Delivery confirmed.");
}
export async function addShippingInvoiceAction(fd: FormData) {
  const u = await requirePermission("finance.view");
  const amount = parseNairaToMinor(str(fd, "amount"));
  await run(`/admin/freight?tab=invoices`, () => addShippingInvoice(u.id, { providerKey: str(fd, "providerKey"), invoiceNumber: str(fd, "invoiceNumber"), amountMinor: amount ?? 0n, currency: str(fd, "currency").toUpperCase() || "NGN", issuedAt: new Date(str(fd, "issuedAt") || Date.now()), consolidationId: str(fd, "consolidationId") || undefined, note: str(fd, "note") }), "Invoice recorded.");
}
export async function vendorRegisterInboundAction(fd: FormData) {
  const { vendorId, user } = await requireVendor("orders");
  const vo = str(fd, "vendorOrderId");
  await run(`/vendor/shipments?order=${vo}`, () => registerInbound(vendorId, user.id, { vendorOrderId: vo, warehouseId: str(fd, "warehouseId"), carrier: str(fd, "carrier"), tracking: str(fd, "tracking"), pieces: int(fd, "pieces") || 1 }), "Parcel registered. The warehouse will confirm when it arrives.");
}

// ─── Returns ─────────────────────────────────────────────────────────────────

export async function requestReturnAction(fd: FormData) {
  const u = await requireUser();
  await run("/account/shipments", () => requestReturn(u.id, str(fd, "vendorOrderId"), str(fd, "reason"), str(fd, "details")), "Return requested. The seller will respond shortly.");
}
export async function returnShippedAction(fd: FormData) {
  const u = await requireUser();
  await run("/account/shipments", () => markReturnShipped(u.id, str(fd, "id"), str(fd, "carrier"), str(fd, "tracking")), "Thanks — the seller has the tracking details.");
}
export async function vendorDecideReturnAction(fd: FormData) {
  const { vendorId, user } = await requireVendor("orders");
  await run(`/vendor/orders/${str(fd, "vendorOrderId")}`, () => decideReturn({ id: user.id, vendorId }, str(fd, "id"), fd.get("decision") === "approve", str(fd, "note")), "Return decision recorded.");
}
export async function vendorReceiveReturnAction(fd: FormData) {
  const { vendorId, user } = await requireVendor("orders");
  await run(`/vendor/orders/${str(fd, "vendorOrderId")}`, () => receiveReturnAndRefund({ id: user.id, vendorId }, str(fd, "id"), str(fd, "note")), "Return received and the customer refunded.");
}
export async function adminDecideReturnAction(fd: FormData) {
  const u = await requirePermission("order.manage");
  const decision = str(fd, "decision");
  await run(`/admin/shipments?tab=returns`, () => decision === "refund" ? receiveReturnAndRefund({ id: u.id, staff: true }, str(fd, "id"), str(fd, "note")) : decideReturn({ id: u.id, staff: true }, str(fd, "id"), decision === "approve", str(fd, "note")), "Return updated.");
}
