/**
 * Checkout courier rates (ShippingRateService). For each vendor sub-order with physical items, active carrier
 * providers that serve the vendor's pickup country → Nigeria are asked for live rates. Nothing is estimated:
 *  - no rates without the vendor's pickup address and real product weights and dimensions;
 *  - only providers whose terms allow showing stored rates (checkoutRates !== false) and naira rates;
 *  - provider errors simply mean no courier options (the vendor's own delivery options still show).
 * The platform markup (provider feeBps + feeFixedMinor) is added and recorded separately from the carrier cost.
 * Quotes are bound to the cart, vendor and destination+items hash, so the price paid is the price quoted.
 */
import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { SHIPPING_ADAPTERS, providerContext, sandboxShippingAllowed } from "@/server/integrations/registry";
import type { Rate } from "@/server/integrations/types";
import { applyBps } from "@/lib/money";
import { getSetting } from "./settings";

export interface DestinationInput { fullName: string; phone: string; line1: string; city: string; state: string; country?: string; email?: string }
export interface CarrierOption {
  id: string; // "q:<quoteId>"
  providerKey: string; providerName: string; courierName: string; methodType: string | null;
  etaText: string | null; etaDaysMin: number | null; etaDaysMax: number | null;
  amountMinor: bigint; trackingAvailable: boolean; restrictions: string | null; recommended: boolean;
}
export type CheckoutLine = { productId: string; quantity: number; name: string; unitPriceMinor: bigint; weightGrams: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export function quoteKey(dest: Pick<DestinationInput, "line1" | "city" | "state" | "country">, lines: Pick<CheckoutLine, "productId" | "quantity">[]) {
  const items = [...lines].sort((a, b) => a.productId.localeCompare(b.productId)).map((l) => `${l.productId}x${l.quantity}`).join(",");
  return createHash("sha256").update(`${norm(dest.line1)}|${norm(dest.city)}|${norm(dest.state)}|${dest.country ?? "NG"}|${items}`).digest("hex");
}

/** Parcel from real product data: longest length, widest width, stacked heights. null when any line lacks data. */
export function parcelFromLines(lines: CheckoutLine[]) {
  if (!lines.length || lines.some((l) => !l.weightGrams || !l.lengthCm || !l.widthCm || !l.heightCm)) return null;
  return {
    weightGrams: lines.reduce((a, l) => a + l.weightGrams! * l.quantity, 0),
    dims: { length: Math.max(...lines.map((l) => l.lengthCm!)), width: Math.max(...lines.map((l) => l.widthCm!)), height: lines.reduce((a, l) => a + l.heightCm! * l.quantity, 0) },
  };
}

export function withMarkup(cost: bigint, feeBps: number, feeFixedMinor: bigint) {
  const markup = (feeBps > 0 ? applyBps(cost, feeBps) : 0n) + feeFixedMinor;
  return { amountMinor: cost + markup, markupMinor: markup };
}

/** Which options to show / preselect, per the admin's selection strategy. */
export function applyStrategy(opts: CarrierOption[], strategy: string, priority: Record<string, number>) {
  if (!opts.length) return opts;
  const cheapest = [...opts].sort((a, b) => (a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0))[0];
  const withEta = opts.filter((o) => o.etaDaysMax != null);
  const fastest = withEta.length ? [...withEta].sort((a, b) => a.etaDaysMax! - b.etaDaysMax! || (a.amountMinor < b.amountMinor ? -1 : 1))[0] : null;
  if (strategy === "CHEAPEST") return [{ ...cheapest, recommended: true }];
  if (strategy === "FASTEST") return fastest ? [{ ...fastest, recommended: true }] : [{ ...cheapest, recommended: true }];
  const sorted = [...opts].sort((a, b) => (priority[a.providerKey] ?? 100) - (priority[b.providerKey] ?? 100) || (a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0));
  if (strategy === "RECOMMENDED") return sorted.map((o, i) => ({ ...o, recommended: i === 0 }));
  return sorted.map((o) => ({ ...o, recommended: false })); // MANUAL: customer chooses
}

export async function checkoutCarrierOptions(cartId: string, dest: DestinationInput, byVendor: Record<string, CheckoutLine[]>) {
  const out: Record<string, { options: CarrierOption[]; note?: string }> = {};
  const vendorIds = Object.keys(byVendor);
  if (!vendorIds.length) return out;
  const [providers, strategy, minutes, vendors] = await Promise.all([
    db.integrationProvider.findMany({ where: { kind: "SHIPPING", active: true } }),
    getSetting(db, "shippingSelection"),
    getSetting(db, "checkoutQuoteMinutes"),
    db.vendor.findMany({ where: { id: { in: vendorIds } }, include: { pickupAddresses: { orderBy: { isDefault: "desc" }, take: 1 } } }),
  ]);
  const destCountry = dest.country ?? "NG";
  const priority = Object.fromEntries(providers.map((p) => [p.key, p.priority]));
  for (const v of vendors) {
    const lines = byVendor[v.id];
    const parcel = parcelFromLines(lines);
    const pickup = v.pickupAddresses[0];
    if (!pickup) { out[v.id] = { options: [], note: "Courier rates aren't available for this seller yet." }; continue; }
    if (!parcel) { out[v.id] = { options: [], note: "Courier rates need the seller to add product weights and sizes." }; continue; }
    const key = quoteKey(dest, lines);
    // Reuse fresh quotes for the same cart, seller, destination and items.
    const cached = await db.shippingQuote.findMany({ where: { cartId, vendorId: v.id, addressHash: key, vendorOrderId: null, expiresAt: { gt: new Date() } } });
    let rows = cached;
    if (!rows.length) {
      rows = [];
      const route = `${pickup.country}>${destCountry}`;
      for (const p of providers) {
        const a = SHIPPING_ADAPTERS.find((x) => x.key === p.key);
        if (!a?.getRates || a.checkoutRates === false || !a.capabilities.includes("RATE_QUOTE") || !a.routes.includes(route)) continue;
        if (a.status === "SANDBOX_SIMULATOR" && !sandboxShippingAllowed()) continue;
        if ((p.minWeightGrams && parcel.weightGrams < p.minWeightGrams) || (p.maxWeightGrams && parcel.weightGrams > p.maxWeightGrams)) continue;
        if (p.zones.length) {
          const zones = await db.shippingZone.findMany({ where: { id: { in: p.zones }, active: true, country: destCountry } });
          if (!zones.some((z) => z.regions.includes(dest.state))) continue;
        }
        let rates: Rate[] = [], requestRef = "";
        try {
          const ctx = await providerContext(p.key);
          const codes = (pickup.providerAddressCodes ?? {}) as Record<string, string | number>;
          const r = await a.getRates(ctx, {
            origin: { name: pickup.contactName, phone: pickup.phone, email: pickup.email, line1: pickup.line1, city: pickup.city, region: pickup.region, country: pickup.country, postalCode: pickup.postalCode, providerCode: codes[p.key] ?? null },
            destination: { name: dest.fullName, phone: dest.phone, email: dest.email ?? "", line1: dest.line1, city: dest.city, region: dest.state, country: destCountry },
            items: lines.map((l) => ({ name: l.name, description: l.name, unitValueMinor: l.unitPriceMinor, quantity: l.quantity, weightGrams: l.weightGrams! })),
            dimensionsCm: parcel.dims,
            pickupDate: new Date(Date.now() + Math.max(1, v.handlingDays) * 864e5).toISOString().slice(0, 10),
            currency: "NGN",
          });
          rates = r.rates; requestRef = r.requestRef;
        } catch { continue; } // provider unavailable: no options from it, never a made-up price
        for (const r of rates.filter((x) => x.currency === "NGN").slice(0, 8)) {
          const { amountMinor, markupMinor } = withMarkup(r.amountMinor, p.feeBps, p.feeFixedMinor);
          rows.push(await db.shippingQuote.create({
            data: {
              providerKey: p.key, vendorId: v.id, cartId, addressHash: key, providerRequestRef: requestRef, courierId: r.courierId, serviceCode: r.serviceCode, courierName: r.courierName,
              amountMinor, costMinor: r.amountMinor, markupMinor, currency: "NGN", etaText: r.etaText, etaDaysMin: r.etaDaysMin, etaDaysMax: r.etaDaysMax,
              methodType: r.methodType ?? "STANDARD", trackingAvailable: r.trackingAvailable ?? true, restrictions: r.restrictions,
              expiresAt: new Date(Date.now() + Math.min(minutes * 60_000, r.validForMs && r.validForMs > 0 ? r.validForMs : minutes * 60_000)),
            },
          }));
        }
      }
    }
    const opts: CarrierOption[] = rows.map((q) => ({
      id: `q:${q.id}`, providerKey: q.providerKey, providerName: SHIPPING_ADAPTERS.find((a) => a.key === q.providerKey)?.name ?? q.providerKey, courierName: q.courierName,
      methodType: q.methodType, etaText: q.etaText, etaDaysMin: q.etaDaysMin, etaDaysMax: q.etaDaysMax, amountMinor: q.amountMinor, trackingAvailable: q.trackingAvailable, restrictions: q.restrictions, recommended: false,
    }));
    out[v.id] = { options: applyStrategy(opts, String(strategy), priority), note: opts.length ? undefined : "No courier rates for this route right now." };
  }
  return out;
}

/** Validates a "q:<id>" choice for the cart + destination it was quoted for. Returns null if unusable. */
export async function resolveCheckoutQuote(choice: string, cartId: string, vendorId: string, addressKey: string | null) {
  if (!choice.startsWith("q:")) return null;
  const q = await db.shippingQuote.findFirst({ where: { id: choice.slice(2), cartId, vendorId, vendorOrderId: null } });
  if (!q || !q.expiresAt || q.expiresAt < new Date()) return null;
  if (addressKey && q.addressHash !== addressKey) return null;
  return q;
}
