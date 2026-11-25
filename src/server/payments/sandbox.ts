/**
 * Sandbox provider: simulates a hosted payment page inside the app. No money moves.
 * The customer chooses "approve" or "decline" on /checkout/sandbox/[reference]; that writes
 * the outcome onto the Payment row, and verify() reads it back — the same verify-after-redirect
 * flow the real providers use, so the rest of the system cannot tell the difference.
 * Disabled automatically when NODE_ENV=production unless ALLOW_SANDBOX_PAYMENTS=true.
 */
import { db } from "@/server/db";
import { sign } from "@/server/auth/tokens";
import type { PaymentProvider } from "./types";

export const sandboxProvider: PaymentProvider = {
  name: "sandbox",
  isLive: false,
  async initialize({ reference }) {
    const token = sign(reference, Date.now() + 60 * 60 * 1000);
    return { authorizationUrl: `/checkout/sandbox/${reference}?t=${encodeURIComponent(token)}` };
  },
  async verify(reference) {
    const p = await db.payment.findUnique({ where: { reference } });
    const outcome = (p?.providerPayload as { sandboxOutcome?: string } | null)?.sandboxOutcome;
    return {
      status: outcome === "approve" ? "success" : outcome === "decline" ? "failed" : "pending",
      amountMinor: p?.amountMinor ?? 0n,
      currency: p?.currency ?? "NGN",
      channel: "sandbox",
      raw: { outcome },
    };
  },
  parseWebhook() {
    return null;
  },
  async refund(reference) {
    return { providerRef: `sandbox-refund-${reference}-${Date.now()}` };
  },
};
