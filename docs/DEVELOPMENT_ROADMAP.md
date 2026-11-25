# Development roadmap

Status legend: ✅ done and tested · 🟡 built, partially tested · ⬜ not started

## Phase 0 — Audit & architecture ✅
Empty repository; Node 22, PostgreSQL 16, Redis 7 available. No existing logo was supplied, so a XavierConnect mark
was designed (`public/brand/`). Docs in `docs/`.

## Phase 1 — Design system & public site ✅
Tokens, components, homepage (CMS-driven sections), shop with filters/sort/pagination, product page with JSON-LD,
stores directory, storefronts, services, compare, help, FAQ (FAQPage JSON-LD), blog shell, legal pages, sitemap, robots.

## Phase 2 — Auth & users ✅
Register, login, logout, email verification, password reset, profile, password change, sessions, RBAC (12 roles).
⬜ MFA for staff.

## Phase 3 — Vendor system ✅
8-step onboarding with KYC upload, storefront, payouts (sandbox), delivery, agreement; admin review with notes;
dashboard, products (variants, images, digital files, scheduling, bulk ops, CSV export, restock), orders, settings,
coupons. 🟡 Vendor staff: role + capability model done; ⬜ self-service invitations. ⬜ CSV import.

## Phase 4 — Marketplace engine ✅
Search with autocomplete, filters, wishlist, guest + persistent carts (merge on login), coupons, multi-vendor checkout,
order splitting, stock reservations, recently viewed.

## Phase 5 — Payments & finance ✅ (sandbox) / 🟡 (Paystack)
Commission engine, double-entry ledger, settlement, payouts with manual approval, refunds, trial balance.
⬜ Live Paystack test with real test keys · ⬜ Paystack split/subaccounts and Transfers API · ⬜ Flutterwave ·
⬜ provider reconciliation report · ⬜ processing-fee capture into ledger.

## Phase 6 — Services & digital ✅
Packages, weekly hours, slot generation (Lagos time), race-safe booking, provider confirm/complete/cancel(+refund),
digital assets with versions, protected downloads. ⬜ Rescheduling UI · ⬜ booking reminders (needs job + SMS).

## Phase 7 — Delivery & communication 🟡
Shipping methods (flat/weight/pickup, free-over, state zones), shipments + events, delivery-partner view with proof of
delivery, in-app notifications, email outbox (console transport). ⬜ SMTP/Resend sender worker · ⬜ SMS/WhatsApp
(Termii) · ⬜ buyer–vendor messaging UI (schema ready) · ⬜ courier API integrations (GIG, DHL).

## Phase 8 — Administration 🟡
Overview, vendors (approve/reject/changes/suspend, KYC viewer), listing moderation, reports queue, featured products,
orders + refunds + rider assignment, finance (payouts, commission rules, ledger), users & roles, support desk,
homepage/banner CMS, audit log. ⬜ Disputes workflow UI · ⬜ blog/static page editor · ⬜ platform settings editor ·
⬜ category manager · ⬜ financial report exports.

## Phase 9 — Marketing & subscriptions 🟡
Vendor coupons, platform coupons (seed), plans with listing limits and per-plan commission. ⬜ Plan billing/upgrade ·
⬜ flash sales · ⬜ referrals/affiliates/loyalty/gift cards · ⬜ abandoned-cart emails.

## Phase 10 — QA & launch 🟡
31 unit/integration tests + browser E2E for workflows A–G pass. ⬜ Lighthouse/accessibility audit · ⬜ full device
matrix · ⬜ load test of checkout · ⬜ items in SECURITY_PLAN "Outstanding".
