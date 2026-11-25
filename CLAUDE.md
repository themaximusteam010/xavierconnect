# XavierConnect — working notes for Claude

Multi-vendor marketplace for Xavier Enterprise. Next.js 15 (App Router, server actions) · TypeScript · Tailwind 4 · Prisma 6 · PostgreSQL.

## Commands
- `npm run dev` — dev server · `npm run build && npm start` — production
- `npm test` — unit + integration (integration creates a throwaway Postgres schema in TEST_DATABASE_URL; never touches DATABASE_URL)
- `npm run typecheck`
- `node tests/e2e/workflows.e2e.cjs` with `BASE=` and `IMG=` — browser test of workflows A–G against a running server (needs `SEED_DEMO=true` seed)
- `npm run db:migrate` (dev) · `npm run db:deploy` (prod) · `SEED_DEMO=true npm run db:seed`

## Rules that must not be broken
- **Money is bigint minor units (kobo).** Use `src/lib/money.ts`. Never `Number` arithmetic on money; `Number()` only for display.
- **Ledger is append-only** (DB triggers enforce it). Every money movement goes through `postLedger()` with an idempotency key. Vendor balances are *derived* from ledger entries — never stored.
- **Tenant boundary:** any vendor query filters by the `vendorId` returned from `requireVendor()`. Never take vendorId from the request.
- **Authorisation:** admin pages call `guard(permission)`; admin actions call `requirePermission(permission)`. Permissions live in `src/server/auth/rbac.ts`; `prisma/rbac-sync.ts` mirrors them to the DB.
- **Payments:** never trust redirects or webhooks; `confirmPayment()` re-verifies with the provider and checks amount + currency. Sandbox provider is refused in production unless `ALLOW_SANDBOX_PAYMENTS=true`.
- Paid digital files and KYC documents live under `storage/private/` and are only served by `/download/[grantId]` and `/admin-docs/[id]`.
- No fabricated data: no fake reviews, ratings, sales counts or testimonials. Demo seed data is labelled "(Demo)".

## Conventions
- Business logic in `src/server/services/*` and pure logic in `src/server/domain/*` (unit-tested). Pages/components stay thin.
- Use `SubmitButton` for every form submit; when a form has several submit buttons, give each `name`/`value` (SubmitButton copies it into a hidden field — the browser submitter isn't relied on).
- Do **not** add `loading.tsx` to the `(site)` group: it blocked same-path server-action redirects (`?step=2 → ?step=3`) in Next 15.5.
- Design tokens are in `src/app/globals.css` (`@theme`). Use them; don't introduce new colours ad hoc.
- Server actions redirect with `?ok=` / `?error=` and pages render `<FlashFromQuery>`.
