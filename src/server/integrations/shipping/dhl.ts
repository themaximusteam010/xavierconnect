/**
 * DHL Express — MyDHL API 3.4.1 (official spec: docs/providers/dhl-express-mydhl-api-3.4.1.yaml, from
 * https://developer.dhl.com/api-reference/dhl-express-mydhl-api). Verified 26 Nov 2026:
 *   Hosts: test https://express.api.dhl.com/mydhlapi/test · production https://express.api.dhl.com/mydhlapi
 *   Auth: HTTP Basic (API key / secret issued by DHL) · header x-version: 3.4.1 (required, "do not change")
 *   GET /rates?accountNumber&originCountryCode&originCityName&originPostalCode&destinationCountryCode&destinationCityName
 *        &destinationPostalCode&weight&length&width&height&plannedShippingDate&isCustomsDeclarable&unitOfMeasurement=metric
 *        → products[] {productName, productCode, totalPrice[{currencyType, priceCurrency, price}],
 *          deliveryCapabilities{estimatedDeliveryDateAndTime, totalTransitDays}}
 *   GET /shipments/{n}/tracking → shipments[].events[] {date, time, typeCode, description, serviceArea[]}
 *   GET /address-validate?type=pickup|delivery&countryCode&cityName&postalCode → pickup/delivery capability check
 * DHL's API terms: "You shall not store and/or modify Product and/or Rating Data" — so DHL rates are shown live to the
 * vendor at booking only (no checkout caching, no markup). Shipment creation (POST /shipments with customs content)
 * and pickups (POST /pickups) are documented but left for implementation against the test host with real credentials.
 * MyDHL has no webhooks; tracking is polled (or via the separate Shipment Tracking – Unified – Push API).
 */
import { providerFetch } from "../http";
import type { ProviderContext, ShippingAdapter, TrackingSnapshot, TrackingUpdate } from "../types";

const HOSTS = { SANDBOX: "https://express.api.dhl.com/mydhlapi/test", LIVE: "https://express.api.dhl.com/mydhlapi" } as const;
const VERSION = "3.4.1";

function headers(ctx: ProviderContext) {
  const { apiKey, apiSecret } = ctx.credentials;
  if (!apiKey || !apiSecret) throw new Error("DHL Express API key and secret are not configured");
  return { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`, "x-version": VERSION, Accept: "application/json" };
}

/** Event codes as they appear in DHL's own spec examples. Anything else: shown, but no status change. */
export const DHL_EVENT_STATUS: Record<string, TrackingUpdate["status"]> = {
  PU: "PICKED_UP", PL: "AT_SORTING_FACILITY", DF: "IN_TRANSIT", AR: "AT_SORTING_FACILITY", CR: "CUSTOMS_PROCESSING", WC: "OUT_FOR_DELIVERY", OK: "DELIVERED", ND: "FAILED_ATTEMPT",
};

/** DHL prices are decimal numbers in the stated currency; convert to minor units without floats. */
export function dhlPriceToMinor(price: number) {
  const [w, f = ""] = price.toFixed(2).split(".");
  return BigInt(w) * 100n + BigInt(f.padEnd(2, "0"));
}

export const dhlExpress: ShippingAdapter = {
  key: "dhl-express",
  name: "DHL Express",
  kind: "SHIPPING",
  capabilities: ["RATE_QUOTE", "TRACKING", "ADDRESS_VALIDATION", "INTERNATIONAL"],
  status: "AVAILABLE",
  routes: ["CN>NG", "GB>NG", "US>NG", "GH>NG", "KE>NG", "ZA>NG", "NG>NG"],
  checkoutRates: false,
  docsUrl: "https://developer.dhl.com/api-reference/dhl-express-mydhl-api",
  notes: "International express (incl. China → Nigeria). Live rates, tracking (polled) and service-area checks implemented from the official MyDHL spec. Label booking and pickups are documented but need DHL test credentials to finish. DHL forbids storing or marking up its rates, so DHL is not offered at checkout.",
  credentialFields: [
    { name: "apiKey", label: "MyDHL API key (username)", secret: false },
    { name: "apiSecret", label: "MyDHL API secret (password)", secret: true },
    { name: "accountNumber", label: "DHL Express shipper account number", secret: false },
  ],
  profile: {
    category: "INTL_EXPRESS", countries: ["*"], scope: ["INTERNATIONAL", "IMPORT", "DOMESTIC"], freightModes: ["AIR"],
    api: "PUBLIC", sandbox: "Test host express.api.dhl.com/mydhlapi/test (500 calls/day) and mock server api-mock.dhl.com",
    businessAccount: "Active DHL Express customer account; API access approved via developer.dhl.com Get Access; import account for China → Nigeria (ask DHL Nigeria)",
    credentialsNote: "API key + secret (HTTP Basic) and the shipper account number",
    supports: { quote: "YES", booking: "YES", tracking: "YES", webhooks: "NO", labels: "YES", pickup: "YES", returns: "UNVERIFIED", addressValidation: "YES", cancel: "YES" },
    baseStatus: "REQUIRES_BUSINESS_APPROVAL", complexity: "MEDIUM",
    remaining: ["Open a DHL Express account (import/export) and request MyDHL API access", "Enter key, secret and account number; run Test connection on the test host", "Implement POST /shipments (customs content, label documents) and POST /pickups against the test host", "Legal check of the rate-data terms before any rate display beyond vendor booking"],
    sources: [
      { label: "MyDHL API reference", url: "https://developer.dhl.com/api-reference/dhl-express-mydhl-api" },
      { label: "Get access", url: "https://developer.dhl.com/express/get-access-with-blocklist/112" },
      { label: "Tracking push API", url: "https://developer.dhl.com/api-reference/shipment-tracking-unified-push" },
    ],
  },

  async validateAddress(ctx, a) {
    const q = new URLSearchParams({ type: "delivery", countryCode: a.country, cityName: a.city, ...(a.postalCode ? { postalCode: a.postalCode } : {}) });
    await providerFetch("dhl-express", "address.validate", `${HOSTS[ctx.mode]}/address-validate?${q}`, { method: "GET", headers: headers(ctx) });
    return { ok: true };
  },

  async getRates(ctx, r) {
    if (!ctx.credentials.accountNumber) throw new Error("DHL Express account number is not configured");
    const grams = r.items.reduce((a, i) => a + i.weightGrams * i.quantity, 0);
    const q = new URLSearchParams({
      accountNumber: ctx.credentials.accountNumber,
      originCountryCode: r.origin.country, originCityName: r.origin.city, ...(r.origin.postalCode ? { originPostalCode: r.origin.postalCode } : {}),
      destinationCountryCode: r.destination.country, destinationCityName: r.destination.city, ...(r.destination.postalCode ? { destinationPostalCode: r.destination.postalCode } : {}),
      weight: (Math.max(grams, 100) / 1000).toFixed(3), length: String(r.dimensionsCm.length), width: String(r.dimensionsCm.width), height: String(r.dimensionsCm.height),
      plannedShippingDate: r.pickupDate, isCustomsDeclarable: String(r.origin.country !== r.destination.country), unitOfMeasurement: "metric",
    });
    const res = await providerFetch<{ products?: { productName: string; productCode: string; totalPrice: { currencyType?: string; priceCurrency?: string; price: number }[]; deliveryCapabilities?: { estimatedDeliveryDateAndTime?: string; totalTransitDays?: number } }[] }>(
      "dhl-express", "rates.get", `${HOSTS[ctx.mode]}/rates?${q}`, { method: "GET", headers: headers(ctx) },
    );
    return {
      requestRef: `dhl:${Date.now()}`,
      rates: (res.products ?? []).flatMap((p) => {
        const price = p.totalPrice.find((t) => t.currencyType === "BILLC") ?? p.totalPrice[0];
        if (!price?.priceCurrency) return [];
        const days = p.deliveryCapabilities?.totalTransitDays;
        return [{
          courierId: "dhl-express", serviceCode: p.productCode, courierName: `DHL ${p.productName}`, amountMinor: dhlPriceToMinor(price.price), currency: price.priceCurrency,
          etaText: p.deliveryCapabilities?.estimatedDeliveryDateAndTime ? `Estimated ${p.deliveryCapabilities.estimatedDeliveryDateAndTime.slice(0, 10)}` : undefined,
          etaDaysMin: days, etaDaysMax: days, methodType: "EXPRESS" as const, trackingAvailable: true,
          restrictions: "Excludes import duties, taxes and some surcharges (DHL terms)", validForMs: 0,
        }];
      }),
    };
  },

  async getTracking(ctx, n): Promise<TrackingSnapshot> {
    const r = await providerFetch<{ shipments?: { events?: { date: string; time?: string; typeCode?: string; description?: string; serviceArea?: { description?: string }[] }[] }[] }>(
      "dhl-express", "tracking.get", `${HOSTS[ctx.mode]}/shipments/${encodeURIComponent(n)}/tracking?trackingView=all-checkpoints&levelOfDetail=shipment`, { method: "GET", headers: headers(ctx), reference: n },
    );
    const events = (r.shipments?.[0]?.events ?? []).map((e) => ({ at: new Date(`${e.date}T${e.time ?? "00:00:00"}`), description: e.description ?? e.typeCode ?? "", location: e.serviceArea?.[0]?.description, rawStatus: e.typeCode }));
    const last = events[events.length - 1];
    return { status: last?.rawStatus ? DHL_EVENT_STATUS[last.rawStatus] ?? null : null, rawStatus: last?.rawStatus, events };
  },

  async testConnection(ctx) {
    const q = new URLSearchParams({ type: "pickup", countryCode: "NG", cityName: "Lagos" });
    await providerFetch("dhl-express", "address.validate", `${HOSTS[ctx.mode]}/address-validate?${q}`, { method: "GET", headers: headers(ctx) });
    return { ok: true, message: `Authenticated with MyDHL ${ctx.mode === "LIVE" ? "production" : "test"}; Lagos pickup capability check succeeded.` };
  },
};
