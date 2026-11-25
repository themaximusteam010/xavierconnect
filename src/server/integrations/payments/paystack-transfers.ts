/**
 * Paystack transfers for Nigerian vendor payouts (NGN → NUBAN).
 * Verified against official docs (Nov 2026):
 *   POST https://api.paystack.co/transferrecipient  {type:"nuban", name, account_number, bank_code, currency}
 *   POST https://api.paystack.co/transfer           {source:"balance", amount, reference, recipient, reason}
 *        reference: 16–50 chars of [a-z0-9_-]
 *   webhooks: transfer.success | transfer.failed | transfer.reversed (signed x-paystack-signature, HMAC-SHA512)
 * If the Paystack integration has OTP approval enabled, the transfer returns status "otp" and must be
 * finalised in the Paystack dashboard; we surface that as OTP_REQUIRED rather than guessing.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { providerFetch } from "../http";
import type { PayoutAdapter, ProviderContext } from "../types";

const BASE = "https://api.paystack.co";
type PS<T> = { status: boolean; message: string; data: T };

const auth = (ctx: ProviderContext) => {
  const k = ctx.credentials.secretKey;
  if (!k) throw new Error("Paystack secret key is not configured");
  if (ctx.mode === "LIVE" && !k.startsWith("sk_live_")) throw new Error("Live mode requires a live secret key");
  if (ctx.mode === "SANDBOX" && !k.startsWith("sk_test_")) throw new Error("Sandbox mode requires a test secret key");
  return { Authorization: `Bearer ${k}`, "Content-Type": "application/json" };
};

/** Paystack reference rules: 16–50 chars, lowercase letters, digits, _ and -. */
export function paystackReference(id: string) {
  const r = `xcpo_${id.toLowerCase().replace(/[^a-z0-9_-]/g, "")}`;
  return r.padEnd(16, "0").slice(0, 50);
}

export const paystackTransfers: PayoutAdapter = {
  key: "paystack",
  name: "Paystack",
  kind: "PAYMENT",
  capabilities: ["COLLECTION", "REFUND", "BENEFICIARY_ONBOARDING", "LOCAL_PAYOUT", "WEBHOOKS"],
  status: "AVAILABLE",
  docsUrl: "https://paystack.com/docs/transfers/single-transfers/",
  notes: "Collections (NGN) and NGN payouts to Nigerian bank accounts. Not verified against a live account from this codebase yet — run Test connection with test keys first. Paystack does not provide NGN→CNY settlement.",
  credentialFields: [{ name: "secretKey", label: "Secret key (sk_test_… / sk_live_…)", secret: true }],

  async createBeneficiary(ctx, b) {
    if (b.country !== "NG" || b.currency !== "NGN" || b.routingType !== "NUBAN") return { status: "REJECTED", message: "Paystack payouts here are limited to Nigerian NUBAN accounts in NGN." };
    if (!/^\d{10}$/.test(b.accountNumber) || !b.bankCode) return { status: "REJECTED", message: "Enter a 10-digit NUBAN and choose a bank." };
    const r = await providerFetch<PS<{ recipient_code: string; details: { account_name: string | null } }>>("paystack", "transferrecipient.create", `${BASE}/transferrecipient`, {
      method: "POST",
      headers: auth(ctx),
      body: JSON.stringify({ type: "nuban", name: b.accountHolderName, account_number: b.accountNumber, bank_code: b.bankCode, currency: "NGN" }),
    });
    return { status: "VERIFIED", recipientRef: r.data.recipient_code, verifiedName: r.data.details.account_name ?? undefined };
  },

  async initiatePayout(ctx, p) {
    if (p.currency !== "NGN") return { status: "FAILED", message: "Paystack payouts here support NGN only." };
    const r = await providerFetch<PS<{ status: string; transfer_code: string; reference: string }>>("paystack", "transfer.create", `${BASE}/transfer`, {
      method: "POST",
      headers: auth(ctx),
      reference: p.reference,
      body: JSON.stringify({ source: "balance", amount: p.amountMinor.toString(), reference: p.reference, recipient: p.recipientRef, reason: p.reason.slice(0, 100) }),
    });
    if (r.data.status === "otp") return { status: "OTP_REQUIRED", providerRef: r.data.transfer_code, message: "Approve this transfer with the OTP in your Paystack dashboard." };
    if (r.data.status === "failed") return { status: "FAILED", providerRef: r.data.transfer_code, message: "Paystack rejected the transfer." };
    return { status: "PROCESSING", providerRef: r.data.transfer_code };
  },

  parseWebhook(ctx, raw, headers) {
    const key = ctx.credentials.secretKey;
    const sig = headers.get("x-paystack-signature");
    if (!key || !sig) return null;
    const expected = createHmac("sha512", key).update(raw).digest("hex");
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const evt = JSON.parse(raw) as { event: string; data: { id?: number; reference?: string; transfer_code?: string; reason?: string } };
    const outcome = evt.event === "transfer.success" ? "SUCCESS" : evt.event === "transfer.failed" ? "FAILED" : evt.event === "transfer.reversed" ? "REVERSED" : undefined;
    return { eventKey: `${evt.event}:${evt.data.id ?? evt.data.reference}`, type: evt.event, reference: evt.data.reference ?? null, outcome, message: evt.data.reason, payload: evt };
  },

  async testConnection(ctx) {
    const r = await providerFetch<PS<unknown[]>>("paystack", "bank.list", `${BASE}/bank?currency=NGN&perPage=5`, { method: "GET", headers: auth(ctx) });
    return { ok: r.status, message: r.status ? "Authenticated with Paystack and listed banks." : r.message };
  },
};
