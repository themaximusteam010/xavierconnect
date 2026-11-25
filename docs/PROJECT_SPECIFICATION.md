# XavierConnect — Project specification

**Owner:** Xavier Enterprise · **Brand:** XavierConnect · **Tagline:** Connecting People. Empowering Businesses.
**Market:** Nigeria first (NGN, 36 states + FCT, Africa/Lagos time), designed for later multi-currency/multi-country expansion.

## Product
A marketplace where individuals, registered businesses and service providers open storefronts and sell:
1. **Physical products**: variants, inventory, vendor-defined delivery.
2. **Services**: Basic/Standard/Premium packages, weekly hours, slot booking, pay-upfront.
3. **Digital products**: private files, expiring and download-limited links after verified payment.

Buyers pay **once** for a cart spanning many sellers; the order is split into one sub-order per seller. Funds sit in a
clearing account until delivery plus a hold window, then move to the seller's withdrawable balance.

## Roles
Super Administrator, Marketplace Administrator, Marketplace Manager, Finance Manager, Vendor Manager, Customer Support
Agent, Content Manager, Customer, Vendor, Service Provider, Vendor Staff, Delivery Partner. A user may hold several
(e.g. customer + vendor). See `src/server/auth/rbac.ts` for the permission matrix.

## Acceptance workflows and status
| | Workflow | Status | Evidence |
|---|---|---|---|
| A | Vendor registration → verification → admin approval → dashboard | ✅ | `tests/e2e/workflows.e2e.cjs`, `tests/integration` |
| B | Product create → photos → submit → moderate → published | ✅ | e2e |
| C | Discover → cart → address → checkout → confirmed order | ✅ | e2e (sandbox payments) |
| D | Multi-vendor order split; vendor isolation | ✅ | e2e + integration (404 on other vendor's order) |
| E | Payment recorded, commission, ledger, settlement, payout | ✅ | integration (trial balance asserted after every step) |
| F | Service booking with slot, payment, provider confirmation | ✅ | e2e |
| G | Digital purchase → protected, limited download | ✅ | e2e |
| H | Admin control: vendors, listings, orders, refunds, payouts, commission, CMS, users, audit | ✅ UI built; partially e2e-tested (approvals) |
| I | Support tickets (customer ↔ staff) | ✅ built, not yet e2e-tested; **disputes UI not built** (schema ready) |
| J | Responsive desktop/mobile | ✅ checked by screenshot at 1440px and iPhone 13; full device matrix not yet run |

See `DEVELOPMENT_ROADMAP.md` for what remains.
