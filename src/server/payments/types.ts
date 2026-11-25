export interface InitializeInput {
  reference: string;
  amountMinor: bigint;
  currency: string;
  email: string;
  callbackUrl: string;
}

export interface VerifyResult {
  status: "success" | "failed" | "pending";
  amountMinor: bigint;
  currency: string;
  channel?: string;
  raw: unknown;
}

export interface WebhookEvent {
  eventKey: string; // unique id used for idempotency
  type: string;
  reference: string | null;
  payload: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  readonly isLive: boolean;
  initialize(input: InitializeInput): Promise<{ authorizationUrl: string }>;
  verify(reference: string): Promise<VerifyResult>;
  /** Returns the parsed event only if the signature is valid. */
  parseWebhook(rawBody: string, headers: Headers): WebhookEvent | null;
  refund(reference: string, amountMinor: bigint): Promise<{ providerRef: string }>;
}
