import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { applyStrategy, parcelFromLines, quoteKey, withMarkup, type CarrierOption, type CheckoutLine } from "@/server/services/shipping-rates";
import { integrationStatus } from "@/server/services/shipping-admin";
import { shipbubble, SHIPBUBBLE_STATUS, toMinorFromDecimal } from "@/server/integrations/shipping/shipbubble";
import { DHL_EVENT_STATUS, dhlPriceToMinor } from "@/server/integrations/shipping/dhl";
import { SHIPPING_ADAPTERS, shippingAdapter } from "@/server/integrations/registry";
import type { IntegrationProvider } from "@prisma/client";

const line = (p: Partial<CheckoutLine> = {}): CheckoutLine => ({ productId: "p1", quantity: 1, name: "Item", unitPriceMinor: 100_000n, weightGrams: 500, lengthCm: 20, widthCm: 15, heightCm: 5, ...p });
const opt = (p: Partial<CarrierOption>): CarrierOption => ({ id: "q:x", providerKey: "a", providerName: "A", courierName: "C", methodType: "STANDARD", etaText: null, etaDaysMin: null, etaDaysMax: null, amountMinor: 100n, trackingAvailable: true, restrictions: null, recommended: false, ...p });
const row = (p: Partial<IntegrationProvider>) => ({ credentialsEnc: null, lastCheckOk: null, ...p }) as IntegrationProvider;

describe("checkout courier helpers", () => {
  it("builds a parcel only from real product data", () => {
    expect(parcelFromLines([line({ quantity: 2 }), line({ productId: "p2", lengthCm: 40, heightCm: 10 })])).toEqual({ weightGrams: 1500, dims: { length: 40, width: 15, height: 20 } });
    expect(parcelFromLines([line(), line({ productId: "p2", weightGrams: null })])).toBeNull();
    expect(parcelFromLines([])).toBeNull();
  });

  it("quote key changes with the address or items, not with formatting", () => {
    const d = { line1: "2 Marina Road", city: "Lagos Island", state: "Lagos" };
    const k = quoteKey(d, [line()]);
    expect(quoteKey({ ...d, line1: "  2   marina road " }, [line()])).toBe(k);
    expect(quoteKey({ ...d, city: "Ikeja" }, [line()])).not.toBe(k);
    expect(quoteKey(d, [line({ quantity: 2 })])).not.toBe(k);
  });

  it("markup is bigint basis points plus a fixed fee", () => {
    expect(withMarkup(250_000n, 1000, 5_000n)).toEqual({ amountMinor: 280_000n, markupMinor: 30_000n });
    expect(withMarkup(250_000n, 0, 0n)).toEqual({ amountMinor: 250_000n, markupMinor: 0n });
  });

  it("applies the admin selection strategy", () => {
    const opts = [opt({ id: "q:1", providerKey: "slow", amountMinor: 100n, etaDaysMax: 7 }), opt({ id: "q:2", providerKey: "fast", amountMinor: 300n, etaDaysMax: 1 }), opt({ id: "q:3", providerKey: "noeta", amountMinor: 200n })];
    expect(applyStrategy(opts, "CHEAPEST", {}).map((o) => o.id)).toEqual(["q:1"]);
    expect(applyStrategy(opts, "FASTEST", {}).map((o) => o.id)).toEqual(["q:2"]);
    const rec = applyStrategy(opts, "RECOMMENDED", { fast: 1, slow: 5, noeta: 9 });
    expect(rec.map((o) => [o.id, o.recommended])).toEqual([["q:2", true], ["q:1", false], ["q:3", false]]);
    expect(applyStrategy(opts, "MANUAL", {}).every((o) => !o.recommended)).toBe(true);
    expect(applyStrategy([], "CHEAPEST", {})).toEqual([]);
  });
});

describe("Shipbubble adapter (per official docs)", () => {
  const ctx = { key: "shipbubble", mode: "SANDBOX" as const, credentials: { apiKey: "sb_sandbox_test_key" } };
  const body = JSON.stringify({ event: "shipment.status.changed", order_id: "SB-123", status: "in_transit", date: "2026-11-20T10:00:00Z", courier: { tracking_code: "TRK1" } });
  const sig = (raw: string, key = "sb_sandbox_test_key") => createHmac("sha512", key).update(raw).digest("hex");

  it("accepts only an x-ship-signature HMAC-SHA512 of the raw body with the API key", () => {
    const ok = shipbubble.parseWebhook!(ctx, body, new Headers({ "x-ship-signature": sig(body) }));
    expect(ok?.status).toBe("IN_TRANSIT");
    expect(ok?.providerShipmentId).toBe("SB-123");
    expect(shipbubble.parseWebhook!(ctx, body, new Headers({ "x-ship-signature": sig(body, "other") }))).toBeNull();
    expect(shipbubble.parseWebhook!(ctx, body.replace("in_transit", "completed"), new Headers({ "x-ship-signature": sig(body) }))).toBeNull();
    expect(shipbubble.parseWebhook!(ctx, body, new Headers())).toBeNull();
  });

  it("ignores statuses it doesn't document instead of guessing", () => {
    const raw = body.replace("in_transit", "teleported");
    expect(shipbubble.parseWebhook!(ctx, raw, new Headers({ "x-ship-signature": sig(raw) }))).toBeNull();
    expect(SHIPBUBBLE_STATUS.completed).toBe("DELIVERED");
    expect(SHIPBUBBLE_STATUS.cancelled).toBe("CANCELLED");
  });

  it("converts decimal naira to kobo without floats drifting", () => {
    expect(toMinorFromDecimal("1234.56")).toBe(123_456n);
    expect(toMinorFromDecimal(2500)).toBe(250_000n);
    expect(toMinorFromDecimal(0.1 + 0.2)).toBe(30n);
  });
});

describe("DHL mapping", () => {
  it("maps only documented checkpoint codes", () => {
    expect(DHL_EVENT_STATUS.OK).toBe("DELIVERED");
    expect(DHL_EVENT_STATUS.PU).toBe("PICKED_UP");
    expect(DHL_EVENT_STATUS.ZZ).toBeUndefined();
    expect(dhlPriceToMinor(123.45)).toBe(12_345n);
  });
});

describe("provider status shown to admins", () => {
  it("is never 'connected' without a passed connection test", () => {
    const sb = shippingAdapter("shipbubble")!;
    expect(integrationStatus(sb, row({}))).toBe("Requires API credentials");
    expect(integrationStatus(sb, row({ credentialsEnc: "x" }))).toBe("Available for integration");
    expect(integrationStatus(sb, row({ credentialsEnc: "x", lastCheckOk: true }))).toBe("Successfully connected");
    expect(integrationStatus(sb, row({ credentialsEnc: "x", lastCheckOk: false }))).toBe("Connection failed");
    expect(integrationStatus(sb, row({ lastCheckOk: true }))).toBe("Requires API credentials");
  });
  it("labels partners without a public API honestly", () => {
    expect(integrationStatus(shippingAdapter("skyways")!, null)).toBe("Not currently supported");
    expect(integrationStatus(shippingAdapter("run-delivery")!, null)).toBe("Requires private API access");
    expect(integrationStatus(shippingAdapter("dhl-express")!, null)).toBe("Requires business approval");
    expect(integrationStatus(shippingAdapter("sandbox-shipping")!, null)).toBe("Test simulator");
  });
  it("only adapters with verified docs claim booking capabilities", () => {
    for (const a of SHIPPING_ADAPTERS) {
      if (a.capabilities.includes("CREATE_SHIPMENT")) expect(typeof a.createShipment).toBe("function");
      if (a.capabilities.includes("RATE_QUOTE")) expect(typeof a.getRates).toBe("function");
      if (a.profile.api === "NONE") expect(a.capabilities).toEqual([]);
    }
  });
});
