# XavierConnect

Multi-vendor marketplace for products, services and digital goods — a Xavier Enterprise company.
*Connecting People. Empowering Businesses.*

## Quick start (local)
Requirements: Node 20+, PostgreSQL 14+.

```bash
cp .env.example .env        # fill DATABASE_URL, TEST_DATABASE_URL, APP_SECRET, SEED_ADMIN_*
npm install
npx prisma migrate deploy
SEED_DEMO=true npm run db:seed
npm run dev                 # http://localhost:3000
```
`SEED_DEMO=true` adds four clearly labelled "(Demo)" stores with listings so you can explore. Omit it for a clean
install. Demo vendor logins: `<store-key>@demo.xavierconnect.local` / `Demo-Vendor-2026!`.

## Tests
```bash
npm test                    # unit + integration (uses a temporary schema in TEST_DATABASE_URL)
npm run build && APP_URL=http://localhost:3100 ALLOW_SANDBOX_PAYMENTS=true npx next start -p 3100 &
BASE=http://localhost:3100 IMG=public/some.png node tests/e2e/workflows.e2e.cjs
```

## Admin setup
Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`, run the seed, sign in, then **change the password** in
Account → Settings. Grant staff roles from Admin → Users & staff → (user) → Platform roles.

## Vendor onboarding
1. Seller creates an account and confirms their email. 2. `/sell/apply`: seller type, business details, ID upload,
storefront, payout account, delivery, agreement, submit. 3. Admin → Vendors → review documents → Approve / Request
changes / Reject. 4. Seller lists products; each goes to Admin → Listings for approval.

## Deployment
- Any Node host (Vercel, Render, Fly, a VPS) + managed PostgreSQL.
- Build: `npm ci && npx prisma migrate deploy && npm run build`; run: `npm start`.
- Set all variables from `.env.example`. **`APP_URL` must be the public URL** (payment callbacks use it).
- Schedule `POST /api/jobs/run` every 5 minutes with `Authorization: Bearer $CRON_SECRET`.
- For more than one instance, switch `STORAGE_DRIVER` to S3/R2 (driver to implement) — local disk isn't shared.
- Paystack: set the webhook URL to `https://<domain>/api/webhooks/paystack`.

## Documentation
`docs/PROJECT_SPECIFICATION.md` · `docs/ARCHITECTURE.md` · `docs/DATABASE_DESIGN.md` · `docs/SECURITY_PLAN.md` ·
`docs/DEVELOPMENT_ROADMAP.md` · `docs/LAUNCH_CHECKLIST.md` · `CLAUDE.md` · brand: `public/brand/README.md`
