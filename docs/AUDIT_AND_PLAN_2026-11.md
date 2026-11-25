# XavierConnect — Repository audit and upgrade plan (Nov 2026)

Scope: upgrade the existing marketplace into an internationally capable, operationally complete platform without
rebuilding it. This audit was produced by reading the repository at commit `3bfc66e` and the live deployment.

## 1. What exists

| Area | Finding | Evidence |
|---|---|---|
| Framework | Next.js 15.5 App Router, React 19, TypeScript strict, Tailwind 4 design tokens | `package.json`, `src/app/globals.css` |
| Database / ORM | PostgreSQL 17 on Supabase (London), Prisma 6, 68 models, 3 migrations, ledger immutability + balance triggers | `prisma/schema.prisma`, `prisma/migrations/*` |
| Auth | Own implementation: argon2id, hashed DB sessions, email verification, password reset, rate limits | `src/server/auth/*`, `src/app/actions/auth.ts` |
| RBAC | 12 roles, 21 permissions, vendor-scoped capabilities; admin pages `guard()`, actions `requirePermission()` | `src/server/auth/rbac.ts`, `admin-guard.ts` |
| Payments | Provider interface with **sandbox** (simulated) and **Paystack collection** (initialize/verify/refund/webhook). Paystack never exercised with real keys | `src/server/payments/*` |
| Ledger | Double-entry, idempotent postings: capture, settlement, payout hold/paid/returned, refund; trial balance | `src/server/domain/ledger.ts`, `services/finance.ts` |
| Orders | Parent order + vendor sub-orders, stock reservation, partial fulfilment/refund, state transitions | `services/orders.ts` |
| Shipping | Vendor-defined flat/weight/pickup methods; manual shipments; delivery-partner proof of delivery. **No carrier integrations** | `ShippingMethod`, `Shipment`, `(dash)/delivery` |
| Admin | Overview, vendors (+detail, KYC viewer), listings moderation, orders (+refund, rider), finance (payouts, commission, trial balance), users & roles, support, content (homepage/banners), audit log | `src/app/(dash)/admin/*` |
| Vendor | Overview, products, orders, services, bookings, earnings/withdrawals, coupons, settings | `src/app/(dash)/vendor/*` |
| Deployment | Vercel (lhr1, Node 22), build runs `prisma migrate deploy && tsx prisma/seed.ts && next build`; daily cron; Postgres file storage | `vercel.json`, Vercel project settings |
| Env vars (names only) | `DATABASE_URL, DIRECT_URL, APP_URL, APP_SECRET, PAYMENT_PROVIDER, ALLOW_SANDBOX_PAYMENTS, PAYSTACK_SECRET_KEY, EMAIL_TRANSPORT, EMAIL_FROM, STORAGE_DRIVER, CRON_SECRET, SEED_*` | `grep process.env` |

## 2. Classification

**Works (tested):** auth, vendor onboarding (NG), moderation, multi-vendor checkout and split, sandbox payment, ledger,
settlement, manual payouts, refunds, bookings, digital downloads, support tickets, CMS homepage. 33 unit/integration
tests + browser E2E (workflows A–G).

**Partially works:** Paystack (code written, never run against Paystack); payouts (manual bank-transfer recording
only, NGN only, no provider transfer); shipping (manual tracking numbers only); admin finance (no filters/exports);
commission/plans (admin-editable commission rules; plan *prices/limits* only editable in the database).

**Visual only / misleading:** the homepage line "Payment held until delivery. Sellers are paid after your order
arrives" — the platform has no licensed escrow/safeguarding arrangement; funds sit with the payment provider on its
normal settlement cycle and the "hold" is an internal ledger rule. Settlement currently releases N days after the
*vendor* marks delivered, which is not verified delivery evidence. **Both must change.**

**Missing:** admin MFA; most of the requested admin modules (customers, categories, payments, settlements,
beneficiaries, shipping, subscriptions, promotions, reviews, disputes, messages, integrations, reports, staff, settings);
multi-country vendors (country is stored but onboarding is Nigeria-only: NG phone validation, state list, NUBAN only);
multi-currency payouts; FX; cross-border payout adapter; provider configuration UI; encrypted credential storage;
carrier integrations; customs data; webhook retry/dead-letter; monitoring alerts; reconciliation; financial exports;
customer delivery confirmation; disputes UI.

**Hardcoded values:** `NGN` currency throughout pricing (intended: marketplace currency); Nigerian bank list in
`src/lib/banks.ts`; `NIGERIAN_STATES`; plan list comes from DB (good) but plan editing has no UI.

**Demo data:** four stores labelled "(Demo)" with 12 products seeded in production (`SEED_DEMO=true`). No fake orders,
reviews or statistics.

**Keep unchanged:** visual identity, logo, homepage layout, storefront/PDP design, design tokens, money-as-bigint,
ledger model, order-split engine, RBAC model.

## 3. Provider research (official sources, Nov 2026)

| Provider | Verified | Status in this codebase |
|---|---|---|
| Paystack collections | `POST /transaction/initialize`, `GET /transaction/verify/:ref`, webhook HMAC-SHA512 | Implemented earlier; needs test keys |
| Paystack transfers | `GET /bank?currency=NGN`, `POST /transferrecipient` (type `nuban`), `POST /transfer` (source, amount, reference 16–50 chars `[a-z0-9_-]`, recipient, reason), `POST /transfer/finalize_transfer` (OTP), webhooks `transfer.success/failed/reversed` | **Implemented now** as LocalPayoutProvider for NG/NGN. Account-name resolve endpoint not verified → not used; recipient creation returns the bank's account name which we display |
| Flutterwave | Not verified this session | Adapter registered with **no capabilities** ("awaiting integration") |
| ChamsSwitch / Kardit | Product page states: *"This service is for approved businesses paying their own suppliers. Models involving payments on behalf of other businesses require a separate partnership review."* Integration is via *"an agreed partnership and integration model"*; quotes must be approved before expiry; payouts to *"eligible Chinese bank accounts (CNAPS)"*; ChamsSwitch is CBN-licensed for switching and processing. No public API documentation found | Adapter registered as **AWAITING_PARTNERSHIP**, no endpoints invented. The NG→CN corridor stays **disabled** until the marketplace partnership review, KYB model and API access are granted |
| Shipbubble | `POST /v1/shipping/address/validate` (name, email, phone, address → `address_code`), `POST /v1/shipping/fetch_rates` (sender/receiver address codes, pickup_date, category_id, package_items, package_dimension → request_token, couriers[] courier_id, service_code, total, currency, delivery_eta), `POST /v1/shipping/labels` (request_token, service_code, courier_id, insurance_code?, duties_paid?), webhooks signed `x-ship-signature` HMAC-SHA512 with the API key; events `shipment.label.created`, `shipment.status.changed`, `shipment.cancelled` … | **Implemented now** (rates, label, webhooks). Auth header format not stated on the page — implemented as `Authorization: Bearer <key>` and must be confirmed in sandbox. Cancel endpoint not verified → cancellation capability off |
| DHL Express, NIPOST | Not verified this session | Adapters registered with **no capabilities** until credentials and docs are confirmed |

## 4. Architecture decisions

1. **Pricing currency stays NGN** (marketplace currency). Vendors in other countries list in NGN; their *settlement*
   currency is their payout currency. The ledger stays single-currency (NGN). Conversion happens only at payout, via a
   provider FX quote stored with rate, fee, expiry and provider reference. Listing in CNY is a later step.
2. **Provider capability registry**: each adapter declares capabilities (`COLLECTION`, `REFUND`, `LOCAL_PAYOUT`,
   `CROSS_BORDER_PAYOUT`, `FX_QUOTE`, `BENEFICIARY_ONBOARDING`, `SETTLEMENT_STATUS`, `RATE_QUOTE`, `CREATE_SHIPMENT`,
   `LABEL`, `TRACKING`, `CANCEL`, `DELIVERY_CONFIRMATION`). Admin configuration (active, mode, countries, currencies,
   approval state, encrypted credentials) lives in `IntegrationProvider`.
3. **Payout corridors** (`PayoutCorridor`: country × currency × provider) gate everything. A corridor can only be
   `LIVE` when its provider is approved **and** compliance approval is recorded by an admin.
4. **Delivery evidence before settlement**: carrier delivered event, rider proof of delivery, customer confirmation,
   digital delivery, or completed service. A vendor's own "delivered" claim only becomes eligible after a longer
   configurable window with no open dispute. Open disputes always block settlement.
5. **Payout truth comes from the provider**: API payouts move to `PAID` only from a provider webhook/status check.
   The manual-transfer path remains for providers without APIs and requires a bank reference.
6. **Secrets** encrypted with AES-256-GCM (`ENCRYPTION_KEY`), never returned to the browser; only a 4-char hint.
7. **Admin MFA** (TOTP, RFC 6238) required for every staff role before `/admin` opens.
8. **Webhooks**: verified, stored once (unique key), processed idempotently, retried with backoff, dead-lettered after
   5 failures with an admin alert.

## 5. Regulatory assumptions (to be confirmed by counsel)

- XavierConnect is a technology marketplace; it does **not** hold customer funds, perform FX, remit money or provide
  escrow. Collection, safeguarding, FX and payout are performed by licensed partners under their licences.
- **NG domestic (NGN)**: collection and payouts via a CBN-licensed PSP (e.g. Paystack) under its marketplace terms.
- **NG → CN (NGN → CNY)**: requires a partner licensed for cross-border payments who approves *marketplace* settlement
  to third-party sellers; CBN FX rules and Chinese inbound rules apply; KYB of Chinese sellers is the partner's
  responsibility. **Disabled** until approval.
- Other corridors (GH, KE, ZA, GB, US): disabled; configured per partner once coverage is confirmed.
- The homepage copy about holding payment has been changed to describe buyer protection without claiming custody of
  funds.

## 6. Plan (this iteration)

Phase 1–2: MFA, admin layout with 28-item navigation, dashboard with date filters and charts, customers, vendors and
verification, products/categories/services/bookings/digital, orders, payments + detail, settlements, payouts,
beneficiaries, finance with filters and CSV export, integrations (payments/shipping), settings, staff, audit logs.
Phase 3: multi-country onboarding, beneficiaries, corridors, FX quote workflow, cross-border adapter interface.
Phase 4: shipping adapters (sandbox simulator, Shipbubble), pickup addresses, quotes, labels, tracking, customs.
Phase 5: disputes, reviews, reports, monitoring alerts, reconciliation, webhook retries.
Phase 6: tests for acceptance scenarios 1–14 (sandbox providers where partners are not yet connected).

Production database changes are **additive migrations only** and are not deployed until reviewed.
