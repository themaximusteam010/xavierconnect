# Server API

Most mutations are **Next.js server actions** (`src/app/actions/*.ts`): POSTed by forms, Origin-checked by Next, each
validates input with Zod and authorises with `requireUser` / `requireVendor(capability)` / `requirePermission(perm)`.

| Module | File | Actions |
|---|---|---|
| Auth | actions/auth.ts | register, login, logout, resendVerification, forgotPassword, resetPassword |
| Account | actions/account.ts | addresses, profile, password, sign out everywhere, notifications read, tickets |
| Cart / checkout | actions/cart.ts, checkout.ts | addToCart, updateCartItem, applyCoupon, placeOrder, payOrder, sandboxDecision |
| Booking | actions/booking.ts | bookService |
| Onboarding | actions/onboarding.ts | chooseType, saveBusiness, uploadDocument, saveStore, savePayout, saveShipping, submit |
| Vendor | actions/vendor.ts, vendor-products.ts | products CRUD/bulk/stock, order status, payouts, store, shipping, services, bookings, coupons |
| Admin | actions/admin.ts | vendor review/suspend, moderation, featured, payouts, settlement, refunds, rider assignment, users/roles, tickets, CMS, commission, reports |
| Delivery | actions/delivery.ts | deliveryUpdate |

## HTTP routes
| Method & path | Auth | Purpose |
|---|---|---|
| GET `/api/search/suggest?q=` | public, rate-limited | Autocomplete: categories, products, stores |
| POST `/api/webhooks/paystack` | `x-paystack-signature` HMAC-SHA512 | Payment events (idempotent) |
| POST `/api/jobs/run` | `Bearer CRON_SECRET` | Expire reservations, release settlements |
| GET `/checkout/callback?reference=` | — | Provider return; verifies server-side |
| GET `/media/*` | public | Public uploads (images) |
| GET `/download/:grantId` | owner session | Paid digital file (limited, expiring) |
| GET `/admin-docs/:id` | `vendor.view` | KYC document (audit-logged) |
| GET `/vendor-export/products` | vendor `catalog` | CSV export |
| GET `/sitemap.xml`, `/robots.txt` | public | SEO |
