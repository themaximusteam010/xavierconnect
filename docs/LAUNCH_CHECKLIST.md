# Launch checklist

- [ ] Paystack live + test keys configured; full purchase, refund and webhook tested against Paystack test mode
- [ ] `PAYMENT_PROVIDER=paystack`, `ALLOW_SANDBOX_PAYMENTS` unset in production
- [ ] Payout bank verification via Paystack implemented and tested
- [ ] Email sender (SMTP/Resend) worker implemented; SPF/DKIM/DMARC on sending domain
- [ ] Staff MFA enabled; super admin password rotated from seed value
- [ ] CSP header, Redis rate limiting, bot protection on register/checkout
- [ ] S3/R2 storage driver; private bucket not publicly listable
- [ ] Database backups + PITR enabled; restore rehearsed
- [ ] Cron for `/api/jobs/run` running; alert if it fails
- [ ] Error monitoring and uptime checks
- [ ] Legal pages reviewed by Nigerian counsel (current text is a template); NDPA 2023 compliance review
- [ ] Remove demo data (`SEED_DEMO` not used in production)
- [ ] Lighthouse ≥ 90 performance/accessibility on home, shop, product, checkout (mobile)
- [ ] Penetration test
- [ ] Official Xavier Enterprise logo files placed in `public/brand/` if they differ from the mark designed here
