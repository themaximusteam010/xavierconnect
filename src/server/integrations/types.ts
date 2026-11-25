/**
 * Provider capability model. Every adapter declares what it actually supports; the rest of the
 * system checks capabilities instead of provider names. Adapters never invent endpoints: an
 * integration we have not verified against official documentation declares no capabilities.
 */
export type PaymentCapability =
  | "COLLECTION" | "REFUND" | "MARKETPLACE_SPLIT" | "BENEFICIARY_ONBOARDING"
  | "LOCAL_PAYOUT" | "CROSS_BORDER_PAYOUT" | "FX_QUOTE" | "SETTLEMENT_STATUS" | "WEBHOOKS";

export type ShippingCapability =
  | "RATE_QUOTE" | "CREATE_SHIPMENT" | "LABEL" | "TRACKING" | "CANCEL" | "DELIVERY_CONFIRMATION" | "WEBHOOKS" | "INTERNATIONAL";

/** AVAILABLE = implemented against verified docs. Others are registered so admins can track onboarding. */
export type AdapterStatus = "AVAILABLE" | "SANDBOX_SIMULATOR" | "AWAITING_PARTNERSHIP" | "NOT_IMPLEMENTED";

export interface ProviderContext {
  key: string;
  mode: "SANDBOX" | "LIVE";
  credentials: Record<string, string>;
}

export interface AdapterMeta<C extends string> {
  key: string;
  name: string;
  kind: "PAYMENT" | "SHIPPING";
  capabilities: C[];
  status: AdapterStatus;
  docsUrl?: string;
  /** Plain-language notes shown in admin: what is verified, what is pending. */
  notes: string;
  credentialFields: { name: string; label: string; secret: boolean }[];
}

export class ProviderUnavailableError extends Error {
  constructor(provider: string, capability: string) {
    super(`${provider} does not support ${capability} in this deployment.`);
  }
}

// ─── Payments ────────────────────────────────────────────────────────────────

export interface BeneficiaryInput {
  country: string;
  currency: string;
  routingType: string;
  accountHolderName: string;
  bankName: string;
  bankCode?: string;
  branch?: string;
  accountNumber: string;
  extra?: Record<string, string>; // e.g. CNAPS code, SWIFT, business registration number
}

export interface BeneficiaryResult {
  status: "VERIFIED" | "PENDING_VERIFICATION" | "REJECTED";
  recipientRef?: string;
  verifiedName?: string;
  message?: string;
}

export interface FxQuoteResult {
  rate: string; // decimal string, target per 1 source unit
  targetAmountMinor: bigint;
  feeMinor: bigint; // source currency
  expiresAt: Date;
  providerQuoteRef?: string;
}

export interface PayoutInitResult {
  status: "PROCESSING" | "FAILED" | "OTP_REQUIRED";
  providerRef?: string;
  message?: string;
}

export interface ProviderEvent {
  eventKey: string;
  type: string;
  reference: string | null;
  outcome?: "SUCCESS" | "FAILED" | "REVERSED";
  message?: string;
  payload: unknown;
}

export interface PayoutAdapter extends AdapterMeta<PaymentCapability> {
  kind: "PAYMENT";
  createBeneficiary?(ctx: ProviderContext, input: BeneficiaryInput): Promise<BeneficiaryResult>;
  quoteFx?(ctx: ProviderContext, q: { sourceCurrency: string; targetCurrency: string; sourceAmountMinor: bigint }): Promise<FxQuoteResult>;
  initiatePayout?(ctx: ProviderContext, p: { reference: string; amountMinor: bigint; currency: string; recipientRef: string; reason: string; fxQuoteRef?: string }): Promise<PayoutInitResult>;
  parseWebhook?(ctx: ProviderContext, rawBody: string, headers: Headers): ProviderEvent | null;
  testConnection?(ctx: ProviderContext): Promise<{ ok: boolean; message: string }>;
}

// ─── Shipping ────────────────────────────────────────────────────────────────

export interface ShipAddress {
  name: string;
  phone: string;
  email: string;
  line1: string;
  city: string;
  region: string;
  country: string;
  postalCode?: string | null;
  providerCode?: string | number | null;
}

export interface ParcelItem { name: string; description: string; unitValueMinor: bigint; quantity: number; weightGrams: number; hsCode?: string }

export interface RateRequest {
  origin: ShipAddress;
  destination: ShipAddress;
  items: ParcelItem[];
  dimensionsCm: { length: number; width: number; height: number };
  pickupDate: string; // YYYY-MM-DD
  currency: string;
}

export interface Rate { courierId: string; serviceCode: string; courierName: string; amountMinor: bigint; currency: string; etaText?: string }

export interface ShipmentCreated {
  providerShipmentId: string;
  trackingNumber?: string;
  trackingUrl?: string;
  labelUrl?: string;
  courierName?: string;
}

export interface TrackingUpdate {
  eventKey: string;
  providerShipmentId: string;
  status: "PICKED_UP" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED_ATTEMPT" | "RETURNED" | "PENDING";
  note?: string;
  location?: string;
  occurredAt: Date;
  payload: unknown;
}

export interface ShippingAdapter extends AdapterMeta<ShippingCapability> {
  kind: "SHIPPING";
  /** Origin/destination country pairs supported, e.g. "CN>NG". Empty = domestic only. */
  routes: string[];
  quote?(ctx: ProviderContext, r: RateRequest): Promise<{ requestRef: string; rates: Rate[] }>;
  createShipment?(ctx: ProviderContext, s: { requestRef: string; rate: Rate; reference: string; customs?: { incoterm: string; insured: boolean } }): Promise<ShipmentCreated>;
  parseWebhook?(ctx: ProviderContext, rawBody: string, headers: Headers): TrackingUpdate | null;
  testConnection?(ctx: ProviderContext): Promise<{ ok: boolean; message: string }>;
}
