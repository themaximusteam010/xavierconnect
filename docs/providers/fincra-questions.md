# Questions for Fincra (copy and send to your account manager)

Hello,

We run XavierConnect, an online marketplace in Nigeria. We want to use your China payouts API (CNAPS) to pay our sellers in mainland China, using the `merchant_settlement` purpose of fund. Before we integrate, could you please confirm:

1. Can you enable CNY payouts for our merchant account, and fund them from our **NGN** balance (NGN → CNY)?
2. How do we get a quote for an NGN → CNY payout? The `POST /quotes/generate` reference does not list `CNY` or `cnaps`.
3. What is the name and the allowed values of the **processing mode** field (Normal / Instant) on `POST /send`?
4. Is `amount` on `POST /send` in major units (naira) or minor units (kobo)? How do we set an exact CNY amount for the seller?
5. What are your fees for China payouts (Normal/Instant × business/individual), and is the fee added to or deducted from the amount?
6. For `merchant_settlement`: what must the merchant agreement contain, and can one agreement be reused for all payouts to the same seller?
7. Which webhook events are sent for China payouts (including `documents_required`, `change_requested`, `pending` and `cancelled`)? Are `sender.updated` and `counterparty.updated` signed?
8. What are our payout limits, cut-off times and settlement times?
9. Please send your CBN licence details for cross-border payments.
10. Please share sandbox credentials so we can test the full flow.

Thank you.
