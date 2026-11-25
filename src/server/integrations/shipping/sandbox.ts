/**
 * SANDBOX SHIPPING SIMULATOR — not a carrier. Returns deterministic quotes, issues a tracking number and a
 * printable test label, and lets staff/tests push tracking events through the same webhook pipeline a carrier
 * would use. Clearly labelled "Sandbox" in every screen. Refused in production unless explicitly allowed.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ShippingAdapter, TrackingUpdate } from "../types";

const sign = (b: string) => createHmac("sha256", process.env.APP_SECRET ?? "sandbox").update(b).digest("hex");

export function sandboxTrackingCallback(providerShipmentId: string, status: TrackingUpdate["status"], note?: string) {
  const body = JSON.stringify({ id: randomBytes(6).toString("hex"), shipment: providerShipmentId, status, note, at: new Date().toISOString() });
  return { body, headers: new Headers({ "x-sandbox-signature": sign(body) }) };
}

export const sandboxShipping: ShippingAdapter = {
  key: "sandbox-shipping",
  name: "Sandbox carrier",
  kind: "SHIPPING",
  capabilities: ["RATE_QUOTE", "CREATE_SHIPMENT", "LABEL", "TRACKING", "WEBHOOKS", "INTERNATIONAL", "DELIVERY_CONFIRMATION"],
  status: "SANDBOX_SIMULATOR",
  routes: ["NG>NG", "CN>NG", "GH>NG", "GB>NG", "US>NG"],
  notes: "Simulated carrier for testing domestic and China→Nigeria flows. Quotes are formula-based, not real prices. No parcels move.",
  credentialFields: [],
  async quote(_ctx, r) {
    const kg = Math.max(1, Math.ceil(r.items.reduce((a, i) => a + i.weightGrams * i.quantity, 0) / 1000));
    const intl = r.origin.country !== r.destination.country;
    const base = intl ? 1_500_000n : 250_000n; // kobo
    const perKg = intl ? 600_000n : 50_000n;
    const std = base + perKg * BigInt(kg);
    return {
      requestRef: `sbx_req_${randomBytes(5).toString("hex")}`,
      rates: [
        { courierId: "sbx-economy", serviceCode: intl ? "INTL_ECONOMY" : "ECONOMY", courierName: intl ? "Sandbox Air Economy" : "Sandbox Economy", amountMinor: std, currency: "NGN", etaText: intl ? "10–18 business days (sandbox estimate)" : "3–5 business days (sandbox estimate)" },
        { courierId: "sbx-express", serviceCode: intl ? "INTL_EXPRESS" : "EXPRESS", courierName: intl ? "Sandbox Air Express" : "Sandbox Express", amountMinor: (std * 18n) / 10n, currency: "NGN", etaText: intl ? "5–8 business days (sandbox estimate)" : "1–2 business days (sandbox estimate)" },
      ],
    };
  },
  async createShipment(_ctx, s) {
    const id = `SBX${randomBytes(5).toString("hex").toUpperCase()}`;
    return { providerShipmentId: id, trackingNumber: id, courierName: s.rate.courierName };
  },
  parseWebhook(_ctx, raw, h) {
    const sig = h.get("x-sandbox-signature") ?? "";
    const exp = sign(raw);
    if (sig.length !== exp.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
    const e = JSON.parse(raw) as { id: string; shipment: string; status: TrackingUpdate["status"]; note?: string; at: string };
    return { eventKey: `sbx:${e.id}`, providerShipmentId: e.shipment, status: e.status, note: e.note, occurredAt: new Date(e.at), payload: e };
  },
  async testConnection() {
    return { ok: true, message: "Sandbox carrier available. No external connection is made." };
  },
};
