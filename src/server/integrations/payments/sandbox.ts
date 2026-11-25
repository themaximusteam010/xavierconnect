/**
 * SANDBOX SIMULATORS — not real providers. They let the full payout and FX workflow run end to end
 * in development and staging. They are refused in production unless ALLOW_SANDBOX_PAYMENTS=true and
 * are labelled "Sandbox" everywhere in the UI. No money moves.
 *
 * Deterministic behaviour for testing: an account number ending in 0000 is accepted at onboarding
 * but the transfer FAILS at the provider callback stage ("Beneficiary account closed").
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { convertMinor } from "@/server/domain/fx";
import type { PayoutAdapter } from "../types";

export const SANDBOX_FX_RATES: Record<string, string> = {
  "NGN:CNY": "0.0046", "NGN:USD": "0.00065", "NGN:GBP": "0.00051", "NGN:EUR": "0.0006", "NGN:GHS": "0.0098", "NGN:KES": "0.084", "NGN:ZAR": "0.0118",
};

const sign = (body: string) => createHmac("sha256", process.env.APP_SECRET ?? "sandbox").update(body).digest("hex");

/** Builds a signed callback exactly as the simulator would deliver it to our webhook endpoint. */
export function sandboxPayoutCallback(providerKey: string, reference: string, outcome: "SUCCESS" | "FAILED", message?: string) {
  const body = JSON.stringify({ id: randomBytes(6).toString("hex"), event: outcome === "SUCCESS" ? "payout.success" : "payout.failed", reference, message, provider: providerKey });
  return { body, headers: new Headers({ "x-sandbox-signature": sign(body) }) };
}

function makeSandbox(key: string, name: string, crossBorder: boolean): PayoutAdapter {
  return {
    key,
    name,
    kind: "PAYMENT",
    capabilities: crossBorder ? ["BENEFICIARY_ONBOARDING", "CROSS_BORDER_PAYOUT", "FX_QUOTE", "WEBHOOKS"] : ["BENEFICIARY_ONBOARDING", "LOCAL_PAYOUT", "WEBHOOKS"],
    status: "SANDBOX_SIMULATOR",
    notes: crossBorder
      ? "Simulates a licensed cross-border partner (quote → accept → payout → callback). Uses fixed sandbox FX rates. Never enable for live customers."
      : "Simulates a domestic payout provider. Never enable for live customers.",
    credentialFields: [],
    async createBeneficiary(_ctx, b) {
      if (b.routingType === "CNAPS" && !/^\d{12}$/.test(b.extra?.cnaps ?? "")) return { status: "REJECTED", message: "CNAPS code must be 12 digits." };
      if (b.accountNumber.length < 6) return { status: "REJECTED", message: "Account number looks too short." };
      return { status: "VERIFIED", recipientRef: `sbx_rcp_${randomBytes(5).toString("hex")}`, verifiedName: b.accountHolderName.toUpperCase() };
    },
    quoteFx: crossBorder
      ? async (_ctx, q) => {
          const rate = SANDBOX_FX_RATES[`${q.sourceCurrency}:${q.targetCurrency}`];
          if (!rate) throw new Error(`Sandbox has no ${q.sourceCurrency}→${q.targetCurrency} rate`);
          const feeMinor = (q.sourceAmountMinor * 100n + 9_999n) / 10_000n; // 1%, rounded up
          return { rate, feeMinor, targetAmountMinor: convertMinor(q.sourceAmountMinor - feeMinor, rate), expiresAt: new Date(Date.now() + 10 * 60_000), providerQuoteRef: `sbx_q_${randomBytes(5).toString("hex")}` };
        }
      : undefined,
    async initiatePayout(_ctx, p) {
      return { status: "PROCESSING", providerRef: `sbx_trf_${p.reference.slice(-12)}` };
    },
    parseWebhook(_ctx, raw, headers) {
      const sig = headers.get("x-sandbox-signature") ?? "";
      const exp = sign(raw);
      if (sig.length !== exp.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
      const e = JSON.parse(raw) as { id: string; event: string; reference: string; message?: string; provider: string };
      if (e.provider !== key) return null;
      return { eventKey: `${e.event}:${e.id}`, type: e.event, reference: e.reference, outcome: e.event === "payout.success" ? "SUCCESS" : "FAILED", message: e.message, payload: e };
    },
    async testConnection() {
      return { ok: true, message: "Sandbox simulator is available. No external connection is made." };
    },
  };
}

export const sandboxDomesticPayouts = makeSandbox("sandbox-payouts", "Sandbox domestic payouts", false);
export const sandboxCrossBorder = makeSandbox("sandbox-crossborder", "Sandbox cross-border partner", true);
