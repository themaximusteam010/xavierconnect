# Architecture

## Stack
Next.js 15 App Router (React 19, server components + server actions) · TypeScript strict · Tailwind CSS 4 with design
tokens · Prisma 6 / PostgreSQL 16 · argon2id password hashing · Zod validation · Vitest · Playwright.

The repository was empty at start, so the stack in the brief was adopted as-is. Prisma 6 was chosen over the
then-current 7.x/8.x release candidates for API stability.

## Layout
```
prisma/            schema.prisma, migrations (incl. hand-written ledger triggers), seed.ts, rbac-sync.ts
public/brand/      logo assets (woven-X mark, horizontal lockup, mono mark)
src/app/
  (site)/          public storefront + /account (customer area) — SiteHeader/Footer chrome
  (dash)/vendor    seller dashboard          (dash)/admin  admin console     (dash)/delivery  rider view
  actions/         server actions (thin: validate → call service → redirect)
  api/             search suggest, Paystack webhook, cron jobs
  media/ download/ admin-docs/ vendor-export/   file-serving route handlers
src/components/    ui/ (design system), commerce/, layout/, home/
src/lib/           money, validation, slug, markdown, banks
src/server/
  auth/            sessions, RBAC, password, signed tokens, admin guard
  domain/          PURE logic: pricing & order split, commission, ledger rules (unit-tested)
  services/        DB-backed business logic: cart, orders, finance, vendors, catalog, bookings, notify, audit
  payments/        provider interface; sandbox + Paystack implementations
  storage.ts       local storage driver with signature-checked uploads
tests/unit, tests/integration, tests/e2e
```

## Money flow
All amounts are integer kobo (`bigint`). One checkout →
`Order` (customer-facing) → `VendorOrder` per seller → `OrderItem`s.

Pricing (`src/server/domain/pricing.ts`):
- **Vendor coupon:** funded by the vendor; commission is charged on the discounted amount.
- **Platform coupon:** funded by XavierConnect (recorded as promotions expense); the vendor is paid as if undiscounted.
- **Shipping:** collected for the vendor, not commissionable. **Tax:** optional `taxBps`, collected to tax payable.
- Commission: most specific active rule wins (product › vendor › category (with ancestors) › subscription plan › global); `rateBps` + `fixedMinor` per unit, capped at the line amount.

Ledger postings (`src/server/domain/ledger.ts`):
| Event | Entries |
|---|---|
| Payment captured | Dr clearing (total) · Dr promotions (platform discount) · Cr vendor:pending (net) · Cr commission · Cr tax payable |
| Settlement (delivered + hold days) | Dr vendor:pending · Cr vendor:available |
| Withdrawal requested | Dr vendor:available · Cr vendor:payout_hold |
| Withdrawal paid | Dr vendor:payout_hold · Cr clearing |
| Withdrawal rejected/failed | Dr vendor:payout_hold · Cr vendor:available |
| Refund (sub-order) | Dr vendor:pending/available · Dr commission · Dr tax · Cr promotions · Cr clearing |

Postgres enforces: no UPDATE/DELETE on ledger tables; each entry one-sided and positive; each transaction balanced
(deferred constraint trigger). Every posting has a unique idempotency key.

## Payments
`PaymentProvider` interface: `initialize`, `verify`, `parseWebhook`, `refund`.
- **Sandbox** (default): an in-app hosted page with Approve/Decline, protected by an HMAC-signed token. No money moves.
- **Paystack**: implemented against the documented REST API (initialize, verify, refund, HMAC-SHA512 webhook). **Not
  yet exercised against a Paystack account** — needs keys. Flutterwave: not implemented.
`confirmPayment()` locks the payment row, re-verifies with the provider, checks amount/currency, and is safe under
concurrent callback + webhook delivery (tested with 3 concurrent calls).

## Inventory
Stock is decremented by a conditional `UPDATE … WHERE stock >= qty` when the order is placed and an
`InventoryReservation` (30 min) is recorded. Payment commits it; `expireUnpaidOrders()` (cron) releases it. A payment
that arrives after expiry is not captured into the ledger; it is queued as a refund for review.

## Background jobs
`POST /api/jobs/run` with `Authorization: Bearer $CRON_SECRET` runs reservation expiry and settlement release.
Schedule every 5 minutes. (No Redis queue yet; jobs are idempotent and safe to re-run.)

## Storage
`STORAGE_DRIVER=local` writes to `./storage/{public,private}`. Uploads are checked for declared MIME **and** magic
bytes. An S3/R2 driver needs implementing `saveImage`, `savePrivateDocument`, `saveDigitalAsset`, `readStored`.
