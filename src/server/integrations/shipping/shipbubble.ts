/**
 * Shipbubble (https://docs.shipbubble.com). Verified Nov 2026:
 *   POST /v1/shipping/address/validate  {name, email, phone, address, latitude?, longitude?} → data.address_code
 *   POST /v1/shipping/fetch_rates       {sender_address_code, reciever_address_code, pickup_date, category_id,
 *                                        package_items[], package_dimension{}, service_type?, delivery_instructions?}
 *                                        → data.request_token, data.couriers[] {courier_id, service_code, total, currency, delivery_eta}
 *   POST /v1/shipping/labels            {request_token, service_code, courier_id, insurance_code?, is_cod_label?, duties_paid?}
 *                                        → data.order_id, data.tracking_url, data.courier.name
 *   Webhooks: header x-ship-signature = HMAC-SHA512(body, API key); events shipment.status.changed, shipment.cancelled, …
 * NOT stated in the pages read: the auth header format (we send Authorization: Bearer <key> — confirm in sandbox),
 * package_items field names and weight unit, the status vocabulary in webhooks. These are marked below and must be
 * confirmed against the sandbox before go-live. Cancellation is not implemented (endpoint not verified).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { providerFetch } from "../http";
import type { ProviderContext, ShippingAdapter, TrackingUpdate } from "../types";

const BASE = "https://api.shipbubble.com/v1";
const headers = (ctx: ProviderContext) => {
  if (!ctx.credentials.apiKey) throw new Error("Shipbubble API key is not configured");
  return { Authorization: `Bearer ${ctx.credentials.apiKey}`, "Content-Type": "application/json" }; // TO CONFIRM in sandbox
};

/** Naira amounts arrive as numbers/strings with up to 2 decimals; convert to kobo without floats. */
export function toMinorFromDecimal(v: number | string): bigint {
  const s = typeof v === "number" ? v.toFixed(2) : v.trim();
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Unexpected amount "${v}"`);
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

// Mapping of Shipbubble status strings → our statuses. TO CONFIRM against sandbox webhook simulator.
const STATUS: Record<string, TrackingUpdate["status"]> = {
  pending: "PENDING", confirmed: "PENDING", picked_up: "PICKED_UP", in_transit: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY", completed: "DELIVERED", delivered: "DELIVERED", cancelled: "RETURNED", returned: "RETURNED",
};

async function addressCode(ctx: ProviderContext, a: { name: string; email: string; phone: string; line1: string; city: string; region: string; country: string }) {
  const r = await providerFetch<{ data: { address_code: number } }>("shipbubble", "address.validate", `${BASE}/shipping/address/validate`, {
    method: "POST",
    headers: headers(ctx),
    body: JSON.stringify({ name: a.name, email: a.email, phone: a.phone, address: `${a.line1}, ${a.city}, ${a.region}, ${a.country}` }),
  });
  return r.data.address_code;
}

export const shipbubble: ShippingAdapter = {
  key: "shipbubble",
  name: "Shipbubble",
  kind: "SHIPPING",
  capabilities: ["RATE_QUOTE", "CREATE_SHIPMENT", "LABEL", "TRACKING", "WEBHOOKS"],
  status: "AVAILABLE",
  routes: ["NG>NG"],
  docsUrl: "https://docs.shipbubble.com",
  notes: "Multi-courier rates and labels for Nigeria. Address validation, rates, labels and webhook signature are verified from official docs; auth header format, item field names and webhook status values must be confirmed in the Shipbubble sandbox. International routes and duties (Duties Calculator, beta) not enabled. Needs `categoryId` (from Shipbubble's package categories) in credentials.",
  credentialFields: [
    { name: "apiKey", label: "API key", secret: true },
    { name: "categoryId", label: "Default package category ID", secret: false },
  ],

  async quote(ctx, r) {
    const sender = r.origin.providerCode ? Number(r.origin.providerCode) : await addressCode(ctx, r.origin);
    const receiver = await addressCode(ctx, r.destination);
    const body = {
      sender_address_code: sender,
      reciever_address_code: receiver, // sic — spelled this way in Shipbubble's API
      pickup_date: r.pickupDate,
      category_id: Number(ctx.credentials.categoryId),
      package_items: r.items.map((i) => ({ name: i.name, description: i.description, unit_weight: (i.weightGrams / 1000).toFixed(3), unit_amount: (Number(i.unitValueMinor) / 100).toFixed(2), quantity: String(i.quantity) })), // field names TO CONFIRM
      package_dimension: { length: r.dimensionsCm.length, width: r.dimensionsCm.width, height: r.dimensionsCm.height },
    };
    const res = await providerFetch<{ data: { request_token: string; couriers: { courier_id: string; courier_name?: string; service_code: string; total: number; currency: string; delivery_eta?: string }[] } }>(
      "shipbubble", "rates.fetch", `${BASE}/shipping/fetch_rates`, { method: "POST", headers: headers(ctx), body: JSON.stringify(body) },
    );
    return {
      requestRef: res.data.request_token,
      rates: res.data.couriers.map((c) => ({ courierId: String(c.courier_id), serviceCode: c.service_code, courierName: c.courier_name ?? String(c.courier_id), amountMinor: toMinorFromDecimal(c.total), currency: c.currency, etaText: c.delivery_eta })),
    };
  },

  async createShipment(ctx, s) {
    const res = await providerFetch<{ data: { order_id: string; tracking_url?: string; courier?: { name?: string } } }>("shipbubble", "labels.create", `${BASE}/shipping/labels`, {
      method: "POST",
      headers: headers(ctx),
      reference: s.reference,
      body: JSON.stringify({ request_token: s.requestRef, service_code: s.rate.serviceCode, courier_id: s.rate.courierId }),
    });
    return { providerShipmentId: res.data.order_id, trackingNumber: res.data.order_id, trackingUrl: res.data.tracking_url, courierName: res.data.courier?.name };
  },

  parseWebhook(ctx, raw, h) {
    const key = ctx.credentials.apiKey;
    const sig = h.get("x-ship-signature");
    if (!key || !sig) return null;
    const exp = createHmac("sha512", key).update(raw).digest("hex");
    if (sig.length !== exp.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
    const e = JSON.parse(raw) as { event?: string; order_id: string; status?: string; date?: string };
    if (!e.order_id) return null;
    const status = STATUS[(e.status ?? "").toLowerCase()] ?? "IN_TRANSIT";
    return { eventKey: `${e.event ?? "event"}:${e.order_id}:${e.status}:${e.date ?? ""}`, providerShipmentId: e.order_id, status, note: e.status, occurredAt: e.date ? new Date(e.date) : new Date(), payload: e };
  },
};
