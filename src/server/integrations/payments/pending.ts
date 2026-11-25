/** Providers we intend to support but have NOT integrated: registered with no capabilities, so nothing can call them. */
import type { PayoutAdapter } from "../types";

export const chamsswitchKardit: PayoutAdapter = {
  key: "chamsswitch-kardit",
  name: "ChamsSwitch — Kardit",
  kind: "PAYMENT",
  capabilities: [],
  status: "AWAITING_PARTNERSHIP",
  docsUrl: "https://chamsswitch.com/solutions/kardit-supplier-payments/",
  notes:
    "NGN-funded CNY payouts to eligible Chinese bank accounts (CNAPS) with quote approval before expiry (per ChamsSwitch's product page). The page states the service is for businesses paying their own suppliers and that paying on behalf of other businesses requires a separate partnership review. No public API documentation — integration is by partnership agreement. Required before enabling: marketplace partnership approval, KYB model for Chinese sellers, API access and sandbox credentials, FX quote and payout APIs, settlement timing, refund/chargeback terms, webhook security.",
  credentialFields: [],
};

export const flutterwave: PayoutAdapter = {
  key: "flutterwave",
  name: "Flutterwave",
  kind: "PAYMENT",
  capabilities: [],
  status: "NOT_IMPLEMENTED",
  docsUrl: "https://developer.flutterwave.com/",
  notes: "Candidate for NGN collections and domestic/multi-country payouts. Not integrated: endpoints have not been verified against current official documentation in this codebase.",
  credentialFields: [],
};

/** Finance pays by bank transfer outside the platform and records the bank reference. */
export const manualPayouts: PayoutAdapter = {
  key: "manual",
  name: "Manual bank transfer",
  kind: "PAYMENT",
  capabilities: ["LOCAL_PAYOUT"],
  status: "AVAILABLE",
  notes: "Finance staff transfer funds from the company bank account and record the bank reference. Use only where a payout API is not available. Requires two people in production (maker/checker) — enforce in your finance procedures.",
  credentialFields: [],
};
