/**
 * Paystack integration (https://paystack.com/docs/api/).
 * Status: implemented against the documented API; NOT yet exercised against a live or test
 * Paystack account from this codebase. Signature verification is unit-tested.
 * Enable with PAYMENT_PROVIDER=paystack and PAYSTACK_SECRET_KEY.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProvider, VerifyResult } from "./types";

const BASE = "https://api.paystack.co";

function key() {
  const k = process.env.PAYSTACK_SECRET_KEY;
  if (!k) throw new Error("PAYSTACK_SECRET_KEY is not configured");
  return k;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json()) as { status: boolean; message: string; data: T };
  if (!res.ok || !body.status) throw new Error(`Paystack ${path} failed: ${body.message}`);
  return body.data;
}

export function verifyPaystackSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const paystackProvider: PaymentProvider = {
  name: "paystack",
  isLive: true,
  async initialize({ reference, amountMinor, currency, email, callbackUrl }) {
    const data = await call<{ authorization_url: string }>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({ reference, amount: amountMinor.toString(), currency, email, callback_url: callbackUrl }),
    });
    return { authorizationUrl: data.authorization_url };
  },
  async verify(reference): Promise<VerifyResult> {
    const d = await call<{ status: string; amount: number; currency: string; channel: string }>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    return {
      status: d.status === "success" ? "success" : d.status === "failed" || d.status === "abandoned" ? "failed" : "pending",
      amountMinor: BigInt(d.amount),
      currency: d.currency,
      channel: d.channel,
      raw: d,
    };
  },
  parseWebhook(rawBody, headers) {
    if (!verifyPaystackSignature(rawBody, headers.get("x-paystack-signature"), key())) return null;
    const evt = JSON.parse(rawBody) as { event: string; data: { id?: number; reference?: string } };
    return {
      eventKey: `${evt.event}:${evt.data.id ?? evt.data.reference}`,
      type: evt.event,
      reference: evt.data.reference ?? null,
      payload: evt,
    };
  },
  async refund(reference, amountMinor) {
    const d = await call<{ id: number }>("/refund", {
      method: "POST",
      body: JSON.stringify({ transaction: reference, amount: amountMinor.toString() }),
    });
    return { providerRef: String(d.id) };
  },
};
