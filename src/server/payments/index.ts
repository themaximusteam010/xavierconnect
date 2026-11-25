import { paystackProvider } from "./paystack";
import { sandboxProvider } from "./sandbox";
import type { PaymentProvider } from "./types";

const providers: Record<string, PaymentProvider> = { sandbox: sandboxProvider, paystack: paystackProvider };

export function getProvider(name?: string): PaymentProvider {
  const key = name ?? process.env.PAYMENT_PROVIDER ?? "sandbox";
  if (key === "sandbox" && process.env.NODE_ENV === "production" && process.env.ALLOW_SANDBOX_PAYMENTS !== "true") {
    throw new Error("Sandbox payments are disabled in production. Configure PAYMENT_PROVIDER.");
  }
  const p = providers[key];
  if (!p) throw new Error(`Unknown payment provider ${key}`);
  return p;
}

export type { PaymentProvider } from "./types";
