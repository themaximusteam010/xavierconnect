# Integrations, dependencies and outstanding partnerships

Status as of 25 Nov 2026. "Implemented" means code exists and is tested against a **sandbox simulator** or
verified documentation. It does **not** mean a live account exists. Nothing below is live until the provider row is
switched on under **Admin → Integrations**, with credentials and approvals in place.

## Payment providers

| Provider | Role | Code status | What is still needed (owner) |
|---|---|---|---|
| Paystack: collections | NGN card, transfer and USSD checkout | Implemented (`src/server/payments/paystack.ts`); amount, currency and signature verified | Business account activated for **marketplace** use; test keys, then live keys, in Admin → Integrations → Paystack; one end-to-end test purchase, refund and webhook in test mode *(Xavier Enterprise)* |
| Paystack: transfers | NGN payouts to Nigerian banks (NUBAN) | Implemented: `paystack-transfers.ts` (recipient, transfer, OTP-required state, transfer.* webhooks) | Transfers enabled on the Paystack account; decide on OTP (disable for API transfers, or finance finalises each one); fund the transfer balance; set corridor NG/NGN/paystack to LIVE **after** compliance sign-off *(Finance + Paystack)* |
| Manual bank transfer | Fallback NGN payouts | Implemented: finance verifies the account name with the bank, transfers, then records the bank reference | A written maker/checker procedure: two people, one approves and one transfers *(Finance)* |
| ChamsSwitch, Kardit | NGN → CNY supplier payments (CNAPS) | **Adapter registered as AWAITING_PARTNERSHIP. No endpoints are coded**, because no public API exists | (1) Partnership review: ChamsSwitch states that paying *on behalf of other businesses* needs a separate review. (2) KYB model for Chinese sellers. (3) Sandbox and production API documentation and credentials. (4) FX quote/approval flow, fees, refund and chargeback terms. (5) Webhook signing. (6) Compliance confirmation for marketplace settlement. *(Xavier Enterprise ↔ ChamsSwitch)* |
| Fincra (China payouts, CNY via CNAPS) | Registered, no capabilities (AWAITING_PARTNERSHIP). API flow documented in `docs/providers/fincra-china-payouts.md` | Fincra account with CNY enabled; written answers to `docs/providers/fincra-questions.md` (processing-mode field, NGN→CNY quote, amount units, fees, webhooks); sandbox keys; production IP allow-list |
| Flutterwave | Possible NGN collections and multi-country payouts | Placeholder (NOT_IMPLEMENTED), no capabilities | Verify the current official API docs, then implement and test in sandbox |
| Sandbox payouts / sandbox cross-border | Test simulators | Implemented and refused in production unless `ALLOW_SANDBOX_PAYMENTS=true` | Never enable for real vendors |

## Shipping providers

Full report with sources: [`SHIPPING_PROVIDERS.md`](SHIPPING_PROVIDERS.md).

| Provider | Code status | Still needed |
|---|---|---|
| Shipbubble (NG → NG) | Adapter built from the public docs: validate, rates, labels, cancel, tracking, signed webhooks | API key + default category ID; sandbox test of a full booking |
| GIG Logistics | Login + connection test only | GIG merchant account; enum meanings and tracking response from GIG before enabling price/booking |
| DHL Express | Rates (vendor booking), tracking, service-area check | DHL account + MyDHL API access; implement shipment booking against the test host; rate-terms review |
| FedEx | OAuth + connection test only | FedEx account; confirm the Nigeria (Red Star Express) service |
| RUN Delivery | Profile only | API documentation and credentials from RUN |
| Skyways / Aquantuo / Colala | Manual freight workflow | Business accounts; ask each for an API or status feed |
| NIPOST | Profile only | API availability |
| Sandbox carrier | Simulator | Test only. Refused in production unless `ALLOW_SANDBOX_SHIPPING=true` |

## Platform dependencies (environment)

| Variable | Purpose | Required |
|---|---|---|
| `ENCRYPTION_KEY` (64 hex) | AES-256-GCM for provider credentials and bank details. **Losing it makes stored credentials and pending account details unreadable.** Back it up in a secrets manager | Yes |
| `ADMIN_MFA_REQUIRED` | Staff TOTP. Defaults to on; only set `false` for local testing | — |
| `CRON_SECRET` | Bearer for `/api/jobs/run` (settlement, webhook retries, reconciliation, monitoring) | Yes |
| `OPS_ALERT_EMAIL` | Address that receives critical alerts | Recommended |
| `ALLOW_SANDBOX_PAYMENTS` | Must be unset in production | — |
| `ALLOW_SANDBOX_SHIPPING` | Must be unset in production (the sandbox carrier quotes formula prices) | — |
| `PAYSTACK_SECRET_KEY` | Optional fallback; prefer storing the key encrypted in Admin → Integrations | — |

## Not built (explicitly out of scope until partners exist)
- Listing prices in currencies other than NGN; multi-currency ledger.
- Automated subscription billing for paid vendor plans (admin assigns plans; invoicing is manual).
- Buyer-side international checkout (buyers are assumed to be in Nigeria).
- Chargeback handling beyond what the collection provider's dashboard offers.

## Identity and messaging

| Dependency | Status | Needed |
|---|---|---|
| Google OAuth client (Sign in with Google) | Implemented and tested against a local mock OpenID provider and Google's live discovery document; **not yet tested with a real Google client** | Create the OAuth client in Google Cloud Console (docs/GOOGLE_SIGN_IN.md) and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| ClamAV (attachment malware scan) | Implemented (clamd INSTREAM), tested against a protocol stub only | A clamd service reachable from the app (`CLAMAV_HOST`). Vercel cannot run clamd itself; use a small hosted container |
| OCR (Tesseract) and QR (jsQR) | Bundled, no external service | — |
