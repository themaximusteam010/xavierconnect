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

/**
 * Fincra China payouts (CNY to mainland bank accounts over CNAPS). The flow is documented
 * (docs/providers/fincra-china-payouts.md) but key details are not: the required processing-mode field on POST /send,
 * NGN→CNY quoting (the quote endpoint does not list CNY/cnaps), and amount units. Per project rules the adapter stays
 * capability-less until Fincra answers those questions in writing and sandbox credentials are available.
 */
export const fincraChina: PayoutAdapter = {
  key: "fincra",
  name: "Fincra — China payouts",
  kind: "PAYMENT",
  capabilities: [],
  status: "AWAITING_PARTNERSHIP",
  docsUrl: "https://docs.fincra.com/docs/china-payouts",
  notes:
    "Pays CNY into business or personal bank accounts in mainland China over CNAPS; a 'merchant_settlement' purpose with a merchant agreement covers marketplace seller payouts. Senders are verified (hours) and each Chinese seller is registered once (up to 48 h). Before enabling: Fincra must enable CNY for this merchant and confirm NGN→CNY funding, the processing-mode field on POST /send, amount units, fees, and payout webhook events (see docs/providers/fincra-china-payouts.md §12). Production also needs server IP allow-listing.",
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
