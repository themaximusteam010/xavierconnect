# Payment corridors: regulatory position and gating

**This is an engineering summary, not legal advice.** Every corridor must be confirmed with Nigerian counsel and with
the partner's compliance team before it is set to LIVE.

## Operating principle
XavierConnect is a technology marketplace. It does **not** hold customer money, perform foreign exchange, remit funds
or provide escrow. Licensed partners collect buyer payments, safeguard funds, convert currency and pay vendors, under
their own licences and terms. The XavierConnect ledger records what each vendor is owed. **It is not a bank account,
and its balances are not safeguarded funds.**

Enforcement in code:
- A payout corridor (country × currency × provider) is `DISABLED` by default. `LIVE` is only accepted with
  `complianceApproved` recorded by an admin (audit-logged). `SANDBOX` corridors are refused in production.
- Vendors can only register bank accounts, and request payouts, on usable corridors. Their bank account must be in
  their registration country.
- Payouts become `PAID` only on provider confirmation, or a recorded bank reference for manual transfers.
- Earnings are released only after delivery evidence and a hold period. An open dispute blocks release. A vendor's
  own status update never releases funds immediately.

## Corridors

| Corridor | Partner | Default state | Requirements before LIVE | Key rules to confirm |
|---|---|---|---|---|
| NG → NG (NGN) | Paystack transfers; manual bank transfer as fallback | Manual available; Paystack DISABLED | Paystack marketplace use approved; transfers enabled; finance procedure | CBN PSP framework (partner licence); NDPA 2023 for vendor KYC data; FIRS/VAT treatment of commission |
| NG → CN (NGN → CNY) | ChamsSwitch, Kardit (proposed) | **DISABLED** | Partnership review for marketplace (third-party seller) settlement; KYB of Chinese sellers by the partner; signed API access and production approval; FX quote approval flow | CBN foreign-exchange and cross-border payment rules (partner-side); PRC inbound payment / SAFE rules on the receiving side; sanctions and AML screening; who is the remitter of record |
| NG → GH (GHS), KE (KES), ZA (ZAR) | None identified | DISABLED (no corridor row) | Partner with licences in both markets | Bank of Ghana / CBK / SARB inbound rules; local KYC |
| NG → GB (GBP), US (USD) | None identified | DISABLED | Partner with FCA / FinCEN-registered payout capability | UK and US AML and sanctions; tax reporting (e.g. 1099-K for US sellers) |

## Shipping and customs (CN → NG)
- Every international label requires a customs declaration: contents, declared value, HS codes, DAP/DDP and
  insurance. It is stored per shipment.
- Buyers see "import duties and taxes may be charged on arrival" at product, checkout and order level unless the
  seller ships DDP.
- Prohibited and restricted imports (Nigeria Customs Service import prohibition list) must be enforced in listing
  moderation. This is currently a manual review step.
