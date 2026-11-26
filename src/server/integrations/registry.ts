import { db } from "@/server/db";
import { decryptJson } from "@/server/crypto";
import { paystackTransfers } from "./payments/paystack-transfers";
import { sandboxCrossBorder, sandboxDomesticPayouts } from "./payments/sandbox";
import { chamsswitchKardit, flutterwave, manualPayouts } from "./payments/pending";
import { shipbubble } from "./shipping/shipbubble";
import { sandboxShipping } from "./shipping/sandbox";
import { aquantuo, colala, nipost, runDelivery, skyways } from "./shipping/pending";
import { dhlExpress } from "./shipping/dhl";
import { fedex } from "./shipping/fedex";
import { gigLogistics } from "./shipping/gig";
import { ProviderUnavailableError, type PaymentCapability, type PayoutAdapter, type ProviderContext, type ShippingAdapter, type ShippingCapability } from "./types";

export const PAYMENT_ADAPTERS: PayoutAdapter[] = [paystackTransfers, flutterwave, chamsswitchKardit, manualPayouts, sandboxDomesticPayouts, sandboxCrossBorder];
export const SHIPPING_ADAPTERS: ShippingAdapter[] = [shipbubble, gigLogistics, runDelivery, dhlExpress, fedex, skyways, aquantuo, colala, nipost, sandboxShipping];

export const paymentAdapter = (key: string) => PAYMENT_ADAPTERS.find((a) => a.key === key);
export const shippingAdapter = (key: string) => SHIPPING_ADAPTERS.find((a) => a.key === key);

function sandboxAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_SANDBOX_PAYMENTS === "true";
}

/** Load admin configuration + decrypted credentials. Env vars are a fallback for Paystack only. */
export async function providerContext(key: string): Promise<ProviderContext & { active: boolean; approval: string }> {
  const row = await db.integrationProvider.findUnique({ where: { key } });
  let credentials: Record<string, string> = {};
  if (row?.credentialsEnc) credentials = decryptJson<Record<string, string>>(row.credentialsEnc);
  if (key === "paystack" && !credentials.secretKey && process.env.PAYSTACK_SECRET_KEY) credentials.secretKey = process.env.PAYSTACK_SECRET_KEY;
  return { key, mode: row?.mode ?? "SANDBOX", credentials, active: row?.active ?? false, approval: row?.approval ?? "NOT_STARTED" };
}

/** Returns an adapter only if it implements the capability, is active, and (for simulators) is allowed here. */
export async function requirePayment(key: string, cap: PaymentCapability) {
  const a = paymentAdapter(key);
  if (!a || !a.capabilities.includes(cap)) throw new ProviderUnavailableError(key, cap);
  if (a.status === "SANDBOX_SIMULATOR" && !sandboxAllowed()) throw new ProviderUnavailableError(key, `${cap} (sandbox disabled in production)`);
  const ctx = await providerContext(key);
  if (!ctx.active) throw new ProviderUnavailableError(key, `${cap} (provider inactive)`);
  return { adapter: a, ctx };
}

/** The shipping simulator returns formula prices, so production needs its own explicit opt-in (never the payments flag). */
export function sandboxShippingAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_SANDBOX_SHIPPING === "true";
}

export async function requireShipping(key: string, cap: ShippingCapability) {
  const a = shippingAdapter(key);
  if (!a || !a.capabilities.includes(cap)) throw new ProviderUnavailableError(key, cap);
  if (a.status === "SANDBOX_SIMULATOR" && !sandboxShippingAllowed()) throw new ProviderUnavailableError(key, `${cap} (test carrier disabled in production)`);
  const ctx = await providerContext(key);
  if (!ctx.active) throw new ProviderUnavailableError(key, `${cap} (provider inactive)`);
  return { adapter: a, ctx };
}
