/**
 * Shipbubble — Nigerian shipping aggregator (https://docs.shipbubble.com). Verified 26 Nov 2026 from the official docs:
 *   Base URL https://api.shipbubble.com/v1 · Authorization: Bearer <key> · test keys start "sb_sandbox", live "sb_prod"
 *     (get-started.md, get-started/authentication.md)
 *   POST /shipping/address/validate {name,email,phone,address} → data.address_code
 *   GET  /shipping/labels/categories → data[] {category_id, category}
 *   POST /shipping/fetch_rates {sender_address_code, reciever_address_code (sic), pickup_date yyyy-mm-dd, category_id,
 *        package_items[] {name, description, unit_weight (KG), unit_amount, quantity}, package_dimension {length,width,height} (CM),
 *        service_type? "pickup"|"dropoff"} → data.request_token (expires after 7 days), data.couriers[]
 *        {courier_id, courier_name, service_code, service_type, total, currency, delivery_eta, pickup_eta, tracking_level 1–10, …}
 *   POST /shipping/labels {request_token, service_code, courier_id, insurance_code?, is_cod_label?, duties_paid?}
 *        → data.order_id ("SB-…"), data.tracking_url
 *   POST /shipping/labels/cancel/:order_id — only shipments scheduled for a future date ("Shipment label already processed" otherwise)
 *   GET  /shipping/labels/list/:order_ids (≤ 50) → status, courier{name,tracking_code}, events[{location,message,captured}], tracking_url, waybill_document
 *   Status vocabulary: pending, confirmed, picked_up, in_transit, completed, cancelled (tracking/get-shipments.md)
 *   Webhooks: x-ship-signature = HMAC-SHA512(raw body, API key); payload {event, order_id, status, courier, events[], tracking_url, date}
 *   Pickup: chosen at rate time via service_type/pickup_date — no separate pickup endpoint.
 * Not verified (so not implemented): creating a return label (only return *rates* are documented), duties calculator paths.
 * Shipping from Nigeria only: "Shipbubble APIs currently only support shipping from your account's country of origin".
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { providerFetch } from "../http";
import type { ProviderContext, ShippingAdapter, TrackingSnapshot, TrackingUpdate } from "../types";

const BASE = "https://api.shipbubble.com/v1";
export const SHIPBUBBLE_TOKEN_TTL_MS = 7 * 864e5;

function headers(ctx: ProviderContext) {
  const key = ctx.credentials.apiKey;
  if (!key) throw new Error("Shipbubble API key is not configured");
  // Key prefix decides test vs live at Shipbubble; refuse a mismatch with the mode set in admin.
  if (ctx.mode === "LIVE" && !key.startsWith("sb_prod")) throw new Error("Live mode needs a Shipbubble live key (sb_prod…)");
  if (ctx.mode === "SANDBOX" && !key.startsWith("sb_sandbox")) throw new Error("Sandbox mode needs a Shipbubble test key (sb_sandbox…)");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

/** Naira amounts arrive as numbers/strings with up to 2 decimals; convert to kobo without floats. */
export function toMinorFromDecimal(v: number | string): bigint {
  const s = typeof v === "number" ? v.toFixed(2) : v.trim();
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Unexpected amount "${v}"`);
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}
const minorToDecimal = (m: bigint) => `${m / 100n}.${(m % 100n).toString().padStart(2, "0")}`;
const kg = (grams: number) => (Math.max(1, grams) / 1000).toFixed(3);

/** Documented Shipbubble statuses → XavierConnect statuses. Anything else: no status change. */
export const SHIPBUBBLE_STATUS: Record<string, TrackingUpdate["status"]> = {
  pending: "PENDING", confirmed: "AWAITING_PICKUP", picked_up: "PICKED_UP", in_transit: "IN_TRANSIT", completed: "DELIVERED", cancelled: "CANCELLED",
};

async function addressCode(ctx: ProviderContext, a: { name: string; email: string; phone: string; line1: string; city: string; region: string; country: string }) {
  const r = await providerFetch<{ data: { address_code: number } }>("shipbubble", "address.validate", `${BASE}/shipping/address/validate`, {
    method: "POST", headers: headers(ctx),
    body: JSON.stringify({ name: a.name, email: a.email, phone: a.phone, address: `${a.line1}, ${a.city}, ${a.region}, ${a.country}` }),
  });
  return r.data.address_code;
}

type SbCourier = { courier_id: string | number; courier_name?: string; service_code: string; service_type?: string; total: number | string; currency: string; delivery_eta?: string; pickup_eta?: string; tracking_level?: number; is_cod_available?: boolean };
type SbShipment = { order_id: string; status: string; courier?: { name?: string; tracking_code?: string }; events?: { location?: string; message?: string; captured?: string }[]; tracking_url?: string; waybill_document?: string | null };

export const shipbubble: ShippingAdapter = {
  key: "shipbubble",
  name: "Shipbubble",
  kind: "SHIPPING",
  capabilities: ["RATE_QUOTE", "CREATE_SHIPMENT", "LABEL", "TRACKING", "CANCEL", "WEBHOOKS", "PICKUP", "ADDRESS_VALIDATION"],
  status: "AVAILABLE",
  routes: ["NG>NG"],
  rateValidityMs: SHIPBUBBLE_TOKEN_TTL_MS,
  docsUrl: "https://docs.shipbubble.com",
  notes: "One integration, many Nigerian couriers (rates compared per shipment). Rates, labels, cancellation, tracking and signed webhooks implemented from the official docs. Shipments can only originate in the account's own country, so it covers Nigerian vendors and the Nigerian last mile — not China → Nigeria.",
  credentialFields: [
    { name: "apiKey", label: "API key (sb_sandbox… or sb_prod…)", secret: true },
    { name: "categoryId", label: "Default package category ID (from GET /shipping/labels/categories)", secret: false },
  ],
  profile: {
    category: "AGGREGATOR", countries: ["NG"], scope: ["DOMESTIC", "NATIONWIDE"], freightModes: ["ROAD"],
    api: "PUBLIC", sandbox: "Test keys (sb_sandbox…) plus a webhook simulator for sandbox shipments",
    businessAccount: "Shipbubble account with API access enabled; prepaid shipping wallet",
    credentialsNote: "API key (Bearer). Webhook signature uses the same key.",
    supports: { quote: "YES", booking: "YES", tracking: "YES", webhooks: "YES", labels: "YES", pickup: "VIA_BOOKING", returns: "UNVERIFIED", addressValidation: "YES", cancel: "YES" },
    baseStatus: "AVAILABLE_FOR_INTEGRATION", complexity: "LOW",
    remaining: ["Create a Shipbubble account and enable API access", "Paste the sb_sandbox key, set a package category ID, run Test connection", "Point the Shipbubble webhook to /api/webhooks/shipbubble", "Fund the wallet and switch to a sb_prod key for live"],
    sources: [
      { label: "API reference", url: "https://docs.shipbubble.com" },
      { label: "Authentication", url: "https://docs.shipbubble.com/get-started/authentication" },
      { label: "Webhooks", url: "https://docs.shipbubble.com/api-reference/webhooks" },
    ],
  },

  async validateAddress(ctx, a) {
    const code = await addressCode(ctx, a);
    return { ok: true, providerCode: String(code) };
  },

  async getRates(ctx, r) {
    const sender = r.origin.providerCode ? Number(r.origin.providerCode) : await addressCode(ctx, r.origin);
    const receiver = r.destination.providerCode ? Number(r.destination.providerCode) : await addressCode(ctx, r.destination);
    const categoryId = Number(ctx.credentials.categoryId);
    if (!Number.isFinite(categoryId)) throw new Error("Shipbubble package category ID is not configured");
    const res = await providerFetch<{ data: { request_token: string; couriers: SbCourier[] } }>("shipbubble", "rates.fetch", `${BASE}/shipping/fetch_rates`, {
      method: "POST", headers: headers(ctx),
      body: JSON.stringify({
        sender_address_code: sender,
        reciever_address_code: receiver, // sic — spelled this way in Shipbubble's API
        pickup_date: r.pickupDate,
        category_id: categoryId,
        package_items: r.items.map((i) => ({ name: i.name.slice(0, 100), description: (i.description || i.name).slice(0, 200), unit_weight: kg(i.weightGrams), unit_amount: minorToDecimal(i.unitValueMinor), quantity: String(i.quantity) })),
        package_dimension: { length: r.dimensionsCm.length, width: r.dimensionsCm.width, height: r.dimensionsCm.height },
      }),
    });
    return {
      requestRef: res.data.request_token,
      rates: res.data.couriers.map((c) => ({
        courierId: String(c.courier_id), serviceCode: c.service_code, courierName: c.courier_name ?? String(c.courier_id),
        amountMinor: toMinorFromDecimal(c.total), currency: c.currency, etaText: c.delivery_eta,
        methodType: "STANDARD" as const, trackingAvailable: (c.tracking_level ?? 0) > 0, pickupIncluded: c.service_type === "pickup",
        restrictions: c.service_type === "dropoff" ? "Seller drops the parcel at the courier's station" : undefined,
        validForMs: SHIPBUBBLE_TOKEN_TTL_MS,
      })),
    };
  },

  async createShipment(ctx, s) {
    const res = await providerFetch<{ data: { order_id: string; tracking_url?: string; courier?: { name?: string; tracking_code?: string } } }>("shipbubble", "labels.create", `${BASE}/shipping/labels`, {
      method: "POST", headers: headers(ctx), reference: s.reference,
      body: JSON.stringify({ request_token: s.requestRef, service_code: s.rate.serviceCode, courier_id: s.rate.courierId }),
    });
    return { providerShipmentId: res.data.order_id, trackingNumber: res.data.courier?.tracking_code || res.data.order_id, trackingUrl: res.data.tracking_url, courierName: res.data.courier?.name };
  },

  async cancelShipment(ctx, id) {
    const r = await providerFetch<{ status: string; message: string }>("shipbubble", "labels.cancel", `${BASE}/shipping/labels/cancel/${encodeURIComponent(id)}`, { method: "POST", headers: headers(ctx), reference: id });
    return { ok: r.status === "success", message: r.message };
  },

  async getTracking(ctx, id): Promise<TrackingSnapshot> {
    const r = await providerFetch<{ data: SbShipment[] | { results?: SbShipment[] } }>("shipbubble", "labels.track", `${BASE}/shipping/labels/list/${encodeURIComponent(id)}`, { method: "GET", headers: headers(ctx), reference: id });
    const list = Array.isArray(r.data) ? r.data : r.data.results ?? [];
    const s = list.find((x) => x.order_id === id);
    if (!s) throw new Error("Shipment not found at Shipbubble");
    return {
      status: SHIPBUBBLE_STATUS[s.status?.toLowerCase()] ?? null, rawStatus: s.status, trackingUrl: s.tracking_url,
      events: (s.events ?? []).map((e) => ({ at: e.captured ? new Date(e.captured) : new Date(), description: e.message ?? "", location: e.location })),
    };
  },

  async generateLabel(ctx, id) {
    const snap = await providerFetch<{ data: SbShipment[] }>("shipbubble", "labels.document", `${BASE}/shipping/labels/list/${encodeURIComponent(id)}`, { method: "GET", headers: headers(ctx), reference: id });
    const doc = (Array.isArray(snap.data) ? snap.data : []).find((x) => x.order_id === id)?.waybill_document;
    if (!doc) throw new Error("Shipbubble has not issued a waybill document for this shipment yet");
    return { url: doc, format: "URL" };
  },

  parseWebhook(ctx, raw, h) {
    const key = ctx.credentials.apiKey;
    const sig = h.get("x-ship-signature");
    if (!key || !sig) return null;
    const exp = createHmac("sha512", key).update(raw).digest("hex");
    if (sig.length !== exp.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
    const e = JSON.parse(raw) as { event?: string; order_id?: string; status?: string; date?: string; tracking_url?: string; courier?: { tracking_code?: string } };
    if (!e.order_id || !e.event?.startsWith("shipment.")) return null;
    const status = SHIPBUBBLE_STATUS[(e.status ?? "").toLowerCase()];
    if (!status) return null; // unknown vocabulary: never guess a status
    return { eventKey: `${e.event}:${e.order_id}:${e.status}:${e.date ?? ""}`, providerShipmentId: e.order_id, status, note: `${e.event} (${e.status})`, occurredAt: e.date ? new Date(e.date) : new Date(), payload: e };
  },

  async testConnection(ctx) {
    const r = await providerFetch<{ data: { category_id: number; category: string }[] }>("shipbubble", "categories.list", `${BASE}/shipping/labels/categories`, { method: "GET", headers: headers(ctx) });
    const cat = r.data.find((c) => String(c.category_id) === ctx.credentials.categoryId);
    return { ok: true, message: `Connected (${ctx.mode === "LIVE" ? "live" : "test"} key). ${r.data.length} package categories available${cat ? `; default category “${cat.category}” found` : ctx.credentials.categoryId ? "; WARNING: configured category ID not found" : "; set a default category ID"}.` };
  },
};
