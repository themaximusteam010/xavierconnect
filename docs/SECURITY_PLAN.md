# Security plan

## Implemented
| Control | Where |
|---|---|
| Password hashing — argon2id (m=19 MiB, t=2) | `src/server/auth/password.ts` |
| Sessions — 32-byte random token in httpOnly, SameSite=Lax, Secure (prod) cookie; only SHA-256 hash stored; 30-day expiry; "sign out everywhere"; all sessions revoked on password reset and suspension | `src/server/auth/session.ts` |
| Email verification & password reset — single-use, hashed, expiring tokens; reset response doesn't reveal whether an account exists | `src/app/actions/auth.ts` |
| Login hardening — uniform error message, dummy hash on unknown email, per-IP and per-account rate limits | same |
| RBAC — permission catalogue; admin pages `guard()`, admin actions `requirePermission()` | `src/server/auth/*` |
| Resource-level isolation — vendor queries always scoped by session-derived vendorId; customers only see own orders (404 otherwise) | services + pages; tested |
| CSRF — Next.js server actions verify Origin/Host; webhooks/jobs use signatures/bearer secrets, not cookies | framework + routes |
| Input validation — Zod on every action | `src/lib/validation.ts`, actions |
| XSS — React escaping; CMS Markdown rendered to elements (no raw HTML); JSON-LD `<` escaped | `src/lib/markdown.tsx` |
| SQL injection — Prisma parameterised queries; raw SQL uses tagged templates only | — |
| Uploads — MIME allow-list + magic-byte check + size limits; random file names; path traversal guard; private bucket for KYC/digital files | `src/server/storage.ts` |
| Protected downloads — ownership, expiry, revocation, atomic download counter | `src/app/download/[grantId]/route.ts` |
| Payment integrity — server-side verify, amount/currency match, row lock, idempotent ledger, webhook HMAC-SHA512 + event de-duplication | `orders.ts`, `paystack.ts`, webhook route |
| Ledger immutability — DB triggers forbid UPDATE/DELETE; balanced-transaction constraint | init migration |
| Audit log — vendor decisions, role/status changes, payouts, refunds, commission changes, KYC document views | `services/audit.ts` |
| CSV formula-injection guard on exports | `vendor-export/products` |
| Security headers — X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; `x-powered-by` off | `next.config.ts` |
| Sandbox payments refused in production unless explicitly allowed | `payments/index.ts` |

## Outstanding before launch
1. **MFA for staff** (TOTP; `User.mfaSecret` column exists) — required by the brief, not yet built.
2. **Distributed rate limiting** — current limiter is in-memory per process. Back with Redis for multi-instance deploys.
3. **Content-Security-Policy** header (nonce-based) — not set yet.
4. **Bot protection** on register/checkout (e.g. Cloudflare Turnstile).
5. **Payout bank verification** via Paystack `/bank/resolve` + transfer recipients — currently sandbox-only; live mode refuses to save payout accounts.
6. **Malware scanning** of uploaded digital files and KYC documents.
7. **Backups**: daily PostgreSQL base backup + WAL archiving (or managed DB PITR), and nightly sync of `storage/private`. Test restores monthly.
8. **Error monitoring** (e.g. Sentry) and log retention.
9. Independent penetration test before taking live payments.
