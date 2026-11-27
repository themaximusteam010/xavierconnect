# Fincra China (CNY / CNAPS) payouts: verbatim API reference

> **What this file is:** a transcription of Fincra's official docs, retrieved on 2026-11-27 with the Firecrawl scraper.
> Every field name, path, enum, example and error string below is copied from the page cited next to its section.
> Nothing was filled in from general knowledge. Where the docs are silent, contradict each other, or a page would not load,
> this file says so. Section 12 lists every gap. **Do not implement anything listed in section 12 until Fincra confirms it in writing.**
>
> Page "last updated" dates as shown by the docs: the China guide pages say 2026-08-27 (test values: 2026-08-28). The auth, environment and webhook pages say 2025-11-13.

---

## 0. Pages read and load status

| URL | Status |
|---|---|
| https://docs.fincra.com/docs/authentication | 200, read in full |
| https://docs.fincra.com/docs/api-environments | 200, read in full |
| https://docs.fincra.com/docs/sandbox-environment | 200, read in full |
| https://docs.fincra.com/docs/live-environment | 200, read in full |
| https://docs.fincra.com/docs/ip-whitelisting | 200, read in full (linked from "Before you begin") |
| https://docs.fincra.com/docs/encryption | 200, read in full |
| https://docs.fincra.com/docs/china-payouts | 200, read in full |
| https://docs.fincra.com/docs/china-payouts-before-you-begin | 200, read in full |
| https://docs.fincra.com/docs/china-payouts-create-a-sender | 200, read in full |
| https://docs.fincra.com/docs/china-payouts-create-a-counterpart | 200, read in full |
| https://docs.fincra.com/docs/china-payouts-send-a-payout | 200, read in full |
| https://docs.fincra.com/docs/china-payouts-purpose-details-and-documents | 200, read in full |
| https://docs.fincra.com/docs/china-payouts-errors | 200, read in full |
| https://docs.fincra.com/docs/china-payouts-test-values | 200, read in full |
| https://docs.fincra.com/docs/webhooks | 200, read in full |
| https://docs.fincra.com/docs/setup-webhook | 200, read in full |
| https://docs.fincra.com/docs/validating-webhook | 200, read in full |
| https://docs.fincra.com/docs/payout-webhook | 200, read in full |
| https://docs.fincra.com/docs/status-responses-and-meanings | 200, read in full |
| https://docs.fincra.com/docs/same-currency-payouts | 200, read in full |
| https://docs.fincra.com/docs/conversions | 200, read in full (linked from "Send a payout" for quotes) |
| https://docs.fincra.com/reference/generate-quote | 200, read in full (OpenAPI) |
| https://docs.fincra.com/reference/upload-payout-transaction-document | 200, read in full (OpenAPI) |
| https://docs.fincra.com/reference/verify-payout-status-by-reference | 200, read in full (OpenAPI) |
| https://docs.fincra.com/reference/fetch-payout-by-customer-reference | 200, read in full (OpenAPI) |
| https://docs.fincra.com/reference/initiate-payout | 200, read in full. It documents the **older** `POST /disbursements/payouts`, not `POST /send` |
| https://docs.fincra.com/llms.txt (docs index) | 200. It lists **no** reference page for `/send`, `/global-payouts/v1/senders` or `/global-payouts/v1/counterparties` |
| https://docs.fincra.com/reference/create-sender | **404 Not Found**. The "Create a sender" guide links here for "the full field list" |
| https://docs.fincra.com/reference/counterparty-industries | **404 Not Found**. Linked as the `industry` / `payerIndustry` value list |
| https://docs.fincra.com/reference/payer-occupations | **404 Not Found**. Linked as the `payerOccupation` value list |

---

## 1. Environments, authentication, IP allow-list, encryption

### 1.1 Base URLs
Sources: https://docs.fincra.com/docs/api-environments, https://docs.fincra.com/docs/live-environment, https://docs.fincra.com/docs/china-payouts-before-you-begin

> - **Test Environment:** https://sandboxapi.fincra.com
> - **Live Environment:** https://api.fincra.com

China-specific prefixes (verbatim table from *Before you begin*):

| Calls | Sandbox | Production |
| --- | --- | --- |
| `/v1/senders`, `/v1/counterparties` | `https://sandboxapi.fincra.com/global-payouts` | `https://api.fincra.com/global-payouts` |
| `/send`, `/payouts/documents-upload` | `https://sandboxapi.fincra.com` | `https://api.fincra.com` |

> "Accounts created in the Test environment are isolated and cannot be transferred or used in the Live environment. Each environment requires separate business IDs, API keys, and other identifiers." (api-environments)

> "Webhooks set up in Sandbox do not carry over to the Live environment." (live-environment)

> "Live API access is granted only after successful KYC verification." (live-environment)

### 1.2 Authentication headers
Source: https://docs.fincra.com/docs/authentication

```curl
-H "api-key: your_secret_key".
```

> 1. The "`Secret Key`": ... This is to be sent along in a header field: `api-key`, when making api requests.
> 2. The "`Public Key`": The Public Key is intended solely for identifying your account with Fincra. It can be safely published in places like your frontend or mobile app. This is to be sent along in a header field: `x-pub-key`, when making api requests.
> 3. The "`Webhook Encryption Key`": The Encryption Key can be utilized to validate webhooks

Error bodies (verbatim):
```json
"message": "Invalid authentication credentials"
```
```json
"message": "No API key found in request"
```

China guide (https://docs.fincra.com/docs/china-payouts-before-you-begin):
> Send your API key in the `api-key` header on every call.
```shell
curl https://api.fincra.com/global-payouts/v1/senders \
  -H "api-key: $FINCRA_API_KEY"
```
> The `/send` endpoint does not need a request signature.

Every China code sample sends **only** `api-key`; none sends `x-pub-key`. No page mentions an `x-business-id` header. The business id is a **body field** (`business`) on `POST /send` and `POST /quotes/generate`.

China auth error codes (https://docs.fincra.com/docs/china-payouts-errors):

| HTTP | Code |
| --- | --- |
| 401 | `api_key_missing` |
| 401 | `api_key_invalid` |
| 401 | `invalid_ip_address` |
| 401 | `kyb_not_approved` |

> The IP check and the Know Your Business check run in production only.

### 1.3 IP allow-list
Source: https://docs.fincra.com/docs/ip-whitelisting (China guide item 4: "**Your server IP addresses on the allow-list.** Production only.")

> Without your server IP address whitelisted, you would be unable to make any requests to our endpoints.
```curl 403 Forbidden
{
    "success": false,
    "error": "Your IP address is not allowed to access this service",
    "errorType": "ACCESS_DENIED"
}
```
> Also, note that you would not be able to access your API keys if you haven't submitted an IP address to be whitelisted.
> When you are in live mode, the IP address provided should be the public address of your server. ... we are not strict on specific IP addresses on test mode
> We only accept actual IP addresses and not CIDR Blocks (e.g. 0.0.0.0/0).
> You are only allowed two IP address entries, which also counts when you change a previously inputted IP address.

(Wildcard `0.0.0.0` exists but the page says it is "strongly discouraged".)

The allow-list error appears in two forms: 403 `ACCESS_DENIED` (ip-whitelisting page) and 401 `invalid_ip_address` (China errors page). See section 12.

### 1.4 Request encryption / signature
Source: https://docs.fincra.com/docs/encryption

> Encryption is optional and specifically designed for requests sent using our payout API.

The page signs the older `beneficiary`-style payload with HMAC SHA512 and sends it in a `signature` request header. For China: "The `/send` endpoint does not need a request signature." (before-you-begin). **No request signing is needed for the China flow.**

### 1.5 Prerequisites (verbatim list)
Source: https://docs.fincra.com/docs/china-payouts-before-you-begin

> 1. **An API key with the payout permission.**
> 2. **CNY enabled for your business.** Ask your account manager.
> 3. **A funded source wallet.** Fincra debits the wallet of the source currency.
> 4. **Your server IP addresses on the allow-list.** Production only.
> 5. **An approved Know Your Business status.** Production only.
> 6. **A webhook URL.** Fincra sends the payout status, `sender.updated` and `counterparty.updated` to it.

> Fincra enables each currency for each merchant one at a time. Tell your account manager before you send your first CNY payout. (china-payouts)

---

## 2. Flow overview
Source: https://docs.fincra.com/docs/china-payouts

| Object | What it is | Ready when |
| --- | --- | --- |
| Sender | The party that sends the money. | `verificationStatus` is `approved`. Fincra sends `sender.updated`. |
| Counterparty | The party that receives the money. | `status` is `active`. Fincra sends `counterparty.updated`. |
| Payout | One payment from the sender to the counterparty, on the mode you choose. | `status` is `successful` |

Sequence (verbatim from the page's diagram text):
```
POST /global-payouts/v1/senders            -> sndr_... (pending)
POST /global-payouts/v1/senders/{id}/documents
                                           -> verification callback (approved)
POST /global-payouts/v1/counterparties     -> Fincra registers the account with the partner -> Accepted
GET  /global-payouts/v1/counterparties/{id} (active)
POST /send                                 -> Fincra pays the account -> Payout webhook (successful)
```

> **The payee name must match the bank record.** ... A name in Latin characters fails this check. Copy the name from the bank record of the payee.
> **The account must be onshore.** CNAPS pays a bank account in mainland China. The address of the counterparty must be in China.
> **Every payment needs a reason and evidence.** You send a purpose of fund. The purpose sets the trade details and the documents that Fincra needs before it pays.

Timing:
> Make both parties days before your first payout. A new sender needs a verification that takes hours. A new counterparty needs a registration with the payment partner that takes up to 48 hours.

Limits:
> Ask your account manager for the payment limit of your business, the cut-off time and the settlement time. Fincra sets these for each merchant.

### 2.1 Processing modes
Sources: https://docs.fincra.com/docs/china-payouts, https://docs.fincra.com/docs/china-payouts-send-a-payout

| Mode | When it settles | What it suits |
| --- | --- | --- |
| Normal | Business hours, Monday to Friday. Settlement is T+1. | Planned payments, such as a supplier invoice or a payroll run. |
| Instant | Any time, 24 hours a day, 7 days a week. | Payments that cannot wait for the next business day, and weekend or holiday payments. |

> The fee depends on the mode and on the counterparty type. A business account carries a different fee from an individual account, so there are four fee cases. Fincra sets them per merchant.
> Ask your account manager for your rate card.

**The request field name and values for the processing mode are NOT DOCUMENTED.** The guide itself says:
> ### The samples above omit the processing mode
> Take the mode field name from the API reference for `POST /send` and add it to each sample.

No API reference page for `POST /send` exists in the docs index, and the field is not on any page read (see section 12).

---

## 3. Senders

### 3.1 Create a sender: `POST /global-payouts/v1/senders`
Source: https://docs.fincra.com/docs/china-payouts-create-a-sender
Full URL: `https://sandboxapi.fincra.com/global-payouts/v1/senders` (sandbox) / `https://api.fincra.com/global-payouts/v1/senders` (live). Body: JSON (`Content-Type: application/json`).

> A sender is not tied to a currency. One approved sender pays China, and it also pays every other currency that Fincra supports.

`currencyClassification` ("You cannot change it later."):

| Value | Use it for |
| --- | --- |
| `CURRENCY_CLASSIFICATION_FCY` | Foreign-currency payouts only. |
| `CURRENCY_CLASSIFICATION_ALL` | Local and foreign currencies. |
| `CURRENCY_CLASSIFICATION_LCY` | Local currency only. This sender cannot pay China. |

> A sender with `CURRENCY_CLASSIFICATION_LCY` never reaches the `approved` status. Every China payout with that sender returns `Sender is not approved to make transactions.` You cannot change the classification. You must create a new sender.

Required fields (verbatim):
> Every sender needs `type`, `name`, `address`, `idType`, `idNumber` and `currencyClassification`. A foreign-currency sender needs more.

| Sender type | Extra required fields |
| --- | --- |
| `business` | `countryOfIncorporation`, `dateOfIncorporation`, `primaryBusiness`, `natureOfBusiness`, `websiteAddress`. `idType` must be `business_registration_number`. |
| `individual` | `countryOfOrigin`, `birthDate`. `idType` is `passport`, `national_id` or `drivers_license`. |

> The sender address uses `postalCode`. The counterparty address uses `zip`.
> A sender with `countryOfOrigin` set to `CN` cannot pay an individual counterparty in CNY. It can pay a business counterparty.

Fields that appear in the example but are not stated as required or optional: `email`, `phone`, `callbackUrl`, and the sub-fields of `address` (`street`, `city`, `state`, `postalCode`, `country`).
> The full field list is in the [API reference](https://docs.fincra.com/reference/create-sender).

That link returns **404** (see section 12). No types, formats or lengths are documented beyond what the example shows.

Example request (verbatim):
```shell
curl -X POST https://api.fincra.com/global-payouts/v1/senders \
  -H "api-key: $FINCRA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "business",
    "currencyClassification": "CURRENCY_CLASSIFICATION_FCY",
    "name": "Acme Trading Limited",
    "address": {
      "street": "12 Marina Road",
      "city": "Lagos",
      "state": "Lagos",
      "postalCode": "101001",
      "country": "NG"
    },
    "email": "finance@acmetrading.com",
    "phone": "+2348012345678",
    "countryOfIncorporation": "NG",
    "dateOfIncorporation": "2015-03-12",
    "idType": "business_registration_number",
    "idNumber": "RC123456",
    "primaryBusiness": "Electronics import",
    "natureOfBusiness": "Wholesale of consumer electronics",
    "websiteAddress": "https://acmetrading.com",
    "callbackUrl": "https://acmetrading.com/hooks/fincra"
  }'
```

Example response (verbatim):
```json
{
  "id": "sndr_9f21c8a4b5d6e7f8",
  "name": "Acme Trading Limited",
  "type": "business",
  "currencyClassification": "CURRENCY_CLASSIFICATION_FCY",
  "verificationStatus": "pending",
  "isBlacklisted": false
}
```
> Store the `sndr_` id against your own customer record.

This sender response is **not** wrapped in `{success, message, data}`, unlike `/send`. The HTTP status code is not stated.

Test-values note (https://docs.fincra.com/docs/china-payouts-test-values):
> Set a `callbackUrl` on the sender or on the payout to replace your registered URL for one request

### 3.2 Upload sender documents: `POST /global-payouts/v1/senders/{id}/documents`
Source: https://docs.fincra.com/docs/china-payouts-create-a-sender
Body: `multipart/form-data` with fields `documentType` and `file`. "Upload one document for each call."

| Sender type | `idType` | Documents |
| --- | --- | --- |
| Individual | `passport` | `identificationDocumentFront`, `proofOfAddress` |
| Individual | `national_id` or `drivers_license` | `identificationDocumentFront`, `identificationDocumentBack`, `proofOfAddress` |
| Business | `business_registration_number` | `businessRegistrationDocument`, `proofOfAddress`, `articleOfIncorporation`, `memorandumOfAssociation` |

Example request (verbatim):
```shell
curl -X POST https://api.fincra.com/global-payouts/v1/senders/sndr_9f21c8a4b5d6e7f8/documents \
  -H "api-key: $FINCRA_API_KEY" \
  -F "documentType=proofOfAddress" \
  -F "file=@proof-of-address.pdf"
```

> Use a JPEG, a PNG or a PDF. A second upload of the same type replaces the first one.
> A request with no file returns 422 and `No file provided or file is invalid.` A file that is not a JPEG, a PNG or a PDF returns 400 and `Invalid file type. Only JPEG, PNG, and PDF are allowed.`
> The verification starts by itself when the last required document arrives. You do not call anything to start it.

Upload rules (https://docs.fincra.com/docs/china-payouts-test-values):
> You can upload a document only while the sender is `pending`, and replace one only while the sender is `rejected`. A replacement returns the sender to `pending` and starts the verification again ... A sender at `in_review` waits for the compliance team and accepts no upload and no replacement.

The success response body is **not documented**. No file-size limit is documented.

### 3.3 Replace sender documents: `PUT /v1/senders/{id}/documents`
Source: https://docs.fincra.com/docs/china-payouts-create-a-sender. The only mention:
> `rejected` | Replace the documents with `PUT /v1/senders/{id}/documents`.

Request and response shapes are **not documented**. Path by analogy with 3.2: `/global-payouts/v1/senders/{id}/documents`.

### 3.4 Get a sender: `GET /v1/senders/{id}`
Source: https://docs.fincra.com/docs/china-payouts-create-a-sender
> Read the sender with `GET /v1/senders/{id}` before you act on the event. Do not trust the body alone.

Full path, per the base-URL table: `GET {base}/global-payouts/v1/senders/{id}`. The response shape is **not documented**. Presumably it is the sender object of 3.1 (`verificationStatus`, `isBlacklisted`), but no page shows it.

### 3.5 Sender status values
Source: https://docs.fincra.com/docs/china-payouts-create-a-sender

| Status | What you do |
| --- | --- |
| `pending` | Upload the documents. |
| `processing` | Wait. |
| `in_review` | Wait. A person at Fincra reviews the sender. This status sends no event. |
| `approved` | Send the payout. |
| `rejected` | Replace the documents with `PUT /v1/senders/{id}/documents`. |

> Fincra sends the `sender.updated` event once, when the verification completes.
> `status` is `approved` or `rejected`. The event reports a finished verification only, so `processing` and `in_review` send nothing.

The test-values page contradicts this:
> `sender.updated` | A verification reaches `approved`, `rejected` or `in_review`.

See section 12.

---

## 4. Counterparties

### 4.1 Create a counterparty: `POST /global-payouts/v1/counterparties`
Source: https://docs.fincra.com/docs/china-payouts-create-a-counterpart. Body: JSON.

> Set `type` to `CNY_CNAPS`. Send the bank details in `cnyCnapsDetails`. Send no other details object.
> There is no update endpoint and no delete endpoint. To correct a name, an account number or a bank, create a new counterparty and block the old one.

Bank details (`cnyCnapsDetails`):

| Field | Description |
| --- | --- |
| `accountNumber` | The Chinese bank account number. |
| `institutionName` | The name of the bank. |
| `cnapsCode` | The CNAPS interbank clearing code of the branch. |

> Fincra returns the CNAPS code in the `swiftCode` field of the response. Read `swiftCode` when you check a record.

Top-level fields in the examples: `entityType` (`business` | `individual`), `type` (`CNY_CNAPS`), `name` (business), `firstName` / `lastName` / `middleName` (individual), `industry`, `registrationNumber`, `incorporationCountry`, `specialEconomicZone`, `phone`, `document` {`type`, `number`, `issuedCountryCode`, `issuedBy`, `issuedDate`, `expirationDate`}, `cnyCnapsDetails`, and `address` {`street`, `city`, `state`, `zip`, `country`}.

**Business**: "Five fields are required for a Chinese business. Four of them are not required anywhere else."

| Field | Rule |
| --- | --- |
| `name` | The registered Chinese legal name. Chinese characters, digits and parentheses. |
| `registrationNumber` | An 18-character Unified Social Credit Code. Copy it from the business licence. |
| `specialEconomicZone` | The customs zone. Use `not_applicable` unless the business sits in a special zone. |
| `phone` | A Chinese mobile number. |
| `industry` | One value from the [industry list](https://docs.fincra.com/reference/counterparty-industries). |

> These five rules also apply to any business with `incorporationCountry` set to `CN`, whatever the counterparty type.

The industry list link returns **404**. The only known `industry` value is `ecommerce_electronics` (from the example). The only known `specialEconomicZone` value is `not_applicable`.

Business example (verbatim):
```shell
curl -X POST https://api.fincra.com/global-payouts/v1/counterparties \
  -H "api-key: $FINCRA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "business",
    "type": "CNY_CNAPS",
    "name": "深圳市华强电子（集团）有限公司",
    "industry": "ecommerce_electronics",
    "registrationNumber": "91440300MA5EX12345",
    "incorporationCountry": "CN",
    "specialEconomicZone": "not_applicable",
    "phone": "+8613800138000",
    "cnyCnapsDetails": {
      "accountNumber": "6222020200112233445",
      "institutionName": "中国工商银行",
      "cnapsCode": "102584000004"
    },
    "address": {
      "street": "华强北路1002号",
      "city": "深圳",
      "state": "广东",
      "zip": "518000",
      "country": "CN"
    }
  }'
```

**Individual**: "Five fields are required for a Chinese individual."

| Field | Rule |
| --- | --- |
| `firstName` | Chinese characters. The middle dot `·` is allowed for a transliterated name. |
| `document.type` | Must be `national_id`. A passport and a driving licence are not accepted. |
| `document.number` | The resident identity card number. |
| `phone` | A Chinese mobile number. |
| `address.country` | `CN`. |

> **The name order.** `lastName` is optional. A Chinese bank account name often arrives as one field, so you can put the whole name in `firstName`. Fincra joins the parts in the Chinese order and with no space.
```text
name = lastName + middleName + firstName
```
> The `lastName` 王 and the `firstName` 伟 become 王伟.

Individual example (verbatim):
```shell
curl -X POST https://api.fincra.com/global-payouts/v1/counterparties \
  -H "api-key: $FINCRA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "individual",
    "type": "CNY_CNAPS",
    "firstName": "伟",
    "lastName": "王",
    "phone": "+8613912345678",
    "document": {
      "type": "national_id",
      "number": "330106199211030011",
      "issuedCountryCode": "CN",
      "issuedBy": "杭州市公安局",
      "issuedDate": "2020-05-10",
      "expirationDate": "2030-05-09"
    },
    "cnyCnapsDetails": {
      "accountNumber": "6217000010012345678",
      "institutionName": "中国建设银行",
      "cnapsCode": "105100000017"
    },
    "address": {
      "street": "文三路388号",
      "city": "杭州",
      "state": "浙江",
      "zip": "310000",
      "country": "CN"
    }
  }'
```

Rules for every China counterparty:
> `address.country` must be `CN`, because CNAPS pays onshore accounts only.
> The phone number must be a Chinese mobile number. Fincra stores it in the E.164 form. You can send the local form: `13800138000`, `08613800138000` and `+86 138 0013 8000` all become `+8613800138000`.
> A request that breaks any rule on this page returns 400 with the code `validation_error`. The message names the field.

**The create response body is not shown anywhere.** The page states only that ids look like `cp_...`, the record carries `status` and `swiftCode`, and (test values) "Status at creation" is `active` or `pending`.

### 4.2 Get a counterparty: `GET /global-payouts/v1/counterparties/{id}`
Source: https://docs.fincra.com/docs/china-payouts-create-a-counterpart
```shell
curl https://api.fincra.com/global-payouts/v1/counterparties/cp_7a04b1c2d3e4f5a6b7c8d9e0 \
  -H "api-key: $FINCRA_API_KEY"
```
The response body is **not documented**.

> A partner can answer in minutes, or Fincra can wait up to 48 hours. Poll `GET /v1/counterparties/{id}` if you have no webhook endpoint yet. Stop after 48 hours and raise a support ticket.

Polling interval: not documented. Test values: "Do not build around a fixed delay."

### 4.3 Block a counterparty: `POST /v1/counterparties/{id}/blacklist`
Source: https://docs.fincra.com/docs/china-payouts-create-a-counterpart
> `POST /v1/counterparties/{id}/blacklist` moves the status to `blacklisted` and returns the counterparty object. Read that response. Do not wait for an event.

Request body: not documented. Whether a reason field exists: not documented. The payout error `... Reason: <reason>` implies one is stored.

### 4.4 Counterparty status values
Source: https://docs.fincra.com/docs/china-payouts-create-a-counterpart

| Status | Can you pay it? | What you do |
| --- | --- | --- |
| `pending` | No | Wait for the event. |
| `active` | Yes | Send the payout. |
| `failed` | No | Create a new counterparty. |
| `blacklisted` | No | The block is one-way. |

Sandbox (https://docs.fincra.com/docs/china-payouts-test-values):

| Status at creation | Meaning |
| --- | --- |
| `active` | The channel needs no registration. The counterparty is ready at once. |
| `pending` | The registration is running. In the sandbox it becomes `active` in a few seconds, and you receive a `counterparty.updated` event. |

---

## 5. Quote (cross-currency only): `POST /quotes/generate`
Sources: https://docs.fincra.com/docs/china-payouts-send-a-payout, https://docs.fincra.com/reference/generate-quote, https://docs.fincra.com/docs/conversions

China guide:
> A payout that converts a currency needs a quote. Send the reference of the quote in `quoteReference`.
> A payout from a CNY wallet to CNY needs no quote.

Reference (OpenAPI, server `https://sandboxapi.fincra.com`, header `api-key`):
> Quotes are only valid for 30 seconds for cross-currency payouts and conversions.

Required: `sourceCurrency`, `destinationCurrency`, `amount`, `action`, `transactionType`, `business`, `paymentDestination`.

| Field | Type | Enum / description (verbatim) |
|---|---|---|
| `sourceCurrency` | string | "The currency which is used to fund a currency conversion or payout" |
| `destinationCurrency` | string | enum `NGN, USD, EUR, GBP, GHS, KES, UGX, TZX, ZMW, XAF, XOF, USDT, USDC, CNGN` (**CNY is not in this enum**) |
| `amount` | string | "With send action, it represents the amount being sent in the source currency. With receive action, it represents the amount to be received in the destination currency." |
| `action` | string | `send` \| `receive` (default `send`) |
| `transactionType` | string | `conversion` \| `disbursement` (default `conversion`). "If you want to make a payout, choose "disbursement"" |
| `business` | string | "The unique Identifier of the business" |
| `feeBearer` | string | `customer` \| `business` (default `customer`) |
| `paymentDestination` | string | `bank_account`, `fliqpay_wallet`, `mobile_money_wallet`, `crypto_wallet` |
| `paymentScheme` | string | enum `swift, ach, fps, sepa, sepa_instant, chaps, fed_wire, usdt_erc20, usdt_trc20, usdt_solana, usdt_bep20, usdc_erc20, usdc_solana` (**`cnaps` is not in this enum**). "only required when the transaction type is disbursement" |
| `beneficiaryType` | string | `individual` \| `corporate` (default `individual`) |
| `delay` | boolean | "only required when payment integration method is "Global Collections"" |

Example "Payout" response (verbatim):
```json
{
    "success": true,
    "message": "Quote generated successfully",
    "data": {
        "sourceCurrency": "KES",
        "destinationCurrency": "USD",
        "sourceAmount": 10000,
        "destinationAmount": 92.99999999999999,
        "action": "send",
        "transactionType": "disbursement",
        "fee": 1,
        "initialAmount": 10000,
        "quotedAmount": 92.99999999999999,
        "rate": 0.0093,
        "amountToCharge": 10000,
        "amountToReceive": 92,
        "reference": "5a5bf618-f96b-444a-85f0-bcfaa25f77d1",
        "expireAt": "2024-10-10T08:01:52.132Z",
        "feeCurrency": "USD",
        "feeRate": 1
    }
}
```
> Once you generate a quote pay attention to the response field `reference`. This is the quote reference that will be passed in the cross-currency payout request

Note the float values in the example (`92.99999999999999`). Our money rules forbid float arithmetic, so parse these as decimal strings.

China order-amount interaction (https://docs.fincra.com/docs/china-payouts-purpose-details-and-documents):
> On a conversion, Fincra checks the sum after it resolves the quote. ... Calculate the order amounts from the destination amount of the quote, not from the source amount.

---

## 6. Payout

### 6.1 Create payout: `POST /send`
Source: https://docs.fincra.com/docs/china-payouts-send-a-payout
Full URL: `https://sandboxapi.fincra.com/send` / `https://api.fincra.com/send`. Body: **`multipart/form-data`** in every sample. Bracket notation is used for nested fields and files.

Fixed values:

| Field | Value |
| --- | --- |
| `destinationCurrency` | `CNY` |
| `paymentScheme` | `cnaps` |
| `paymentDestination` | `bank_account` |

Fields (verbatim table):

| Field | Required | Notes |
| --- | --- | --- |
| `business` | Yes | Your business id. Exactly 24 characters. |
| `sourceCurrency` | Yes | The wallet you pay from. |
| `destinationCurrency` | Yes | `CNY`. |
| `amount` | Yes | The amount in the source currency. |
| `senderId` | Yes | The `sndr_` id. |
| `counterpartyId` | Yes | The `cp_` id. |
| `customerReference` | Yes | Your own reference. It must be unique. |
| `paymentScheme` | Yes | `cnaps`. |
| `paymentDestination` | Yes | `bank_account`. |
| Processing mode | Yes | Normal or Instant. |
| `purposeOfFund` | Yes | One of 20 values for CNY. |
| `relationshipWithBeneficiary` | Yes | For example `supplier` or `employee`. |
| `additionalPayoutDetails` | Yes | Trade details or salary details. |
| `quoteReference` | For a conversion | The reference of the quote. |
| `files` | No | The supporting documents. |
| `description` | No | Free text. |

> ### Send `senderId` and `paymentScheme` every time
> The schema marks both as optional. Fincra runs the sender checks and the foreign-currency flow only when you send `senderId`. Fincra builds the counterparty type from the currency and the payment scheme, so a missing `paymentScheme` returns a type mismatch.

> The endpoint rejects any field that the table above does not list. It rejects `beneficiary`, `sender`, `correspondent`, `intermediary`, `customerName`, `additionalInfo` and `documentType` from the older `POST /payouts` endpoint.

`relationshipWithBeneficiary`: only `supplier` and `employee` are given, as examples. The full enum is not documented.

`amount` decimals (errors page): `"amount" must be an integer` means "The source currency has no decimal places." Whether `amount` is in major units (naira) or minor units (kobo) is not stated. The example uses `amount=5000000` with `sourceCurrency=NGN`.

Example request (verbatim, cURL):
```shell
curl -X POST https://api.fincra.com/send \
  -H "api-key: $FINCRA_API_KEY" \
  -F "business=64a1f0c2e4b0a12345678901" \
  -F "sourceCurrency=NGN" \
  -F "destinationCurrency=CNY" \
  -F "amount=5000000" \
  -F "quoteReference=QTE-8842-XYZ" \
  -F "senderId=sndr_9f21c8a4b5d6e7f8" \
  -F "counterpartyId=cp_7a04b1c2d3e4f5a6b7c8d9e0" \
  -F "customerReference=PAY-2026-000123" \
  -F "paymentScheme=cnaps" \
  -F "paymentDestination=bank_account" \
  -F "purposeOfFund=goods_purchase" \
  -F "relationshipWithBeneficiary=supplier" \
  -F "description=Q3 electronics restock" \
  -F "additionalPayoutDetails[orders][0][orderedAt]=2026-07-20T10:30:00Z" \
  -F "additionalPayoutDetails[orders][0][item][name]=LED display panels" \
  -F "additionalPayoutDetails[orders][0][item][quantity]=250" \
  -F "additionalPayoutDetails[orders][0][platform][name]=Alibaba" \
  -F "additionalPayoutDetails[orders][0][platform][url]=https://hq-electronics.en.alibaba.com" \
  -F "files[0][documentType]=invoice" \
  -F "files[0][file]=@invoice-8842.pdf"
```
(The guide states that this sample omits the processing-mode field.)

Example response (verbatim):
```json
{
  "success": true,
  "message": "Payout initiated successfully.",
  "data": {
    "id": 90210,
    "reference": "PO-8f3a2c1d",
    "customerReference": "PAY-2026-000123",
    "status": "processing",
    "isDocumentRequired": false,
    "documentsRequired": [],
    "senderId": "sndr_9f21c8a4b5d6e7f8",
    "counterpartyId": "cp_7a04b1c2d3e4f5a6b7c8d9e0"
  }
}
```
> Store the `reference`. You need it to upload a document and to match a webhook.

General warning from the bank-payout reference (https://docs.fincra.com/reference/initiate-payout):
> success: true confirms that Fincra handled the API request; it does not guarantee that the payout settled successfully. Always inspect data.status and continue tracking the payout through webhooks or a status endpoint.

### 6.2 Idempotency / retry
Source: https://docs.fincra.com/docs/china-payouts-send-a-payout
> `customerReference` must be unique for your business. Reuse the same reference when you retry after a 500 response. A second request with a reference that already succeeded returns `Cannot continue, Duplicate Customer Reference Passed`.

Same-currency page (https://docs.fincra.com/docs/same-currency-payouts):
> Only payouts with the explicit status `failed` should be retried. If you receive a `Timeout Message` it doesn't mean the transaction has failed. Kindly re-query using this link before you retry.

### 6.3 Payout status values (China)
Source: https://docs.fincra.com/docs/china-payouts-send-a-payout

| Status | Meaning |
| --- | --- |
| `documents_required` | Fincra holds the payout. A document is missing. |
| `processing` | Fincra works on the payout. |
| `pending` | Fincra waits on an internal step. |
| `successful` | The counterparty received the money. |
| `failed` | The payout did not complete. Read `message`. |
| `change_requested` | Fincra asks for a change. |

The test-values page also produces **`cancelled`** (amount ending `.02`), which this table does not list. Generic payout statuses (https://docs.fincra.com/docs/status-responses-and-meanings): `processing`, `failed`, `successful`.

> Confirm every webhook against the payout reference before you release goods or services. The sandbox sends no payout webhook.

(The test-values page contradicts the last sentence. See section 12.)

### 6.4 Get payout status
`POST /send` has no documented China-specific status endpoint. The general payout-management reference pages are:

**By Fincra reference**: `GET /disbursements/payouts/reference/{transactionReference}` (https://docs.fincra.com/reference/verify-payout-status-by-reference)
**By your reference**: `GET /disbursements/payouts/customer-reference/{customerReference}` (https://docs.fincra.com/reference/fetch-payout-by-customer-reference)

Both are under server `https://sandboxapi.fincra.com` with header `api-key`. Example 200 response (verbatim, identical on both pages; a non-China payout):
```json
{
    "success": true,
    "message": "Payout fetched successfully",
    "data": {
        "id": 31821,
        "amountSent": 4500.67,
        "amountReceived": 9.9,
        "sourceCurrency": "KES",
        "destinationCurrency": "EUR",
        "fee": 9090.909091,
        "quoteId": "6490a6937d6dab0011852bc4",
        "status": "successful",
        "reference": "db396365d80b4d6c",
        "customerReference": null,
        "description": "i want to sha pay money",
        "paymentDestination": "bank_account",
        "paymentScheme": "sepa_instant",
        "additionalInfo": null,
        "traceId": null,
        "message": "Payout was successful",
        "isDocumentRequired": 0,
        "isDocumentUploaded": 0,
        "documentsRequired": null,
        "valuedAt": "2023-06-19T19:03:57.000Z",
        "createdAt": "2023-06-19T19:03:48.000Z",
        "updatedAt": "2023-06-19T19:03:57.000Z",
        "recipient": { "...": "beneficiary-style object, see source page" }
    }
}
```
404 is listed with an empty example body `{}`. **The docs do not state that these endpoints return payouts created with `POST /send`, or which fields a CNY payout carries** (for example `senderId`, `counterpartyId`, processing mode). See section 12.

---

## 7. Purpose of fund, additional details, documents
Source: https://docs.fincra.com/docs/china-payouts-purpose-details-and-documents

### 7.1 Every purpose CNY accepts (verbatim)

| `purposeOfFund` | `additionalPayoutDetails` | Documents |
| --- | --- | --- |
| `payroll_salary` | Salary | `payment_service_agreement`, `payroll_schedule` |
| `employee_payroll` | Salary | `payment_service_agreement`, `payroll_schedule` |
| `family_support` | Salary | `evidence_of_relationship_to_beneficiary` |
| `family_or_living_expense` | Salary | `evidence_of_relationship_to_beneficiary` |
| `personal_transfer` | Salary | `currency_exchange_agreement` |
| `goods_purchase` | Orders | `invoice` |
| `goods_trade` | Orders | `invoice` |
| `payment_for_goods` | Orders | `invoice` |
| `return_of_export_trade` | Orders | `invoice` |
| `merchant_settlement` | Orders | `merchant_agreement` |
| `services_payment` | Orders | `service_contract` |
| `services_trade` | Orders | `service_contract` |
| `payment_for_services` | Orders | `service_contract` |
| `professional_services` | Orders | `service_contract` |
| `information_services` | Orders | `service_contract` |
| `brokerage_services` | Orders | `service_contract` |
| `transportation_services` | Orders | `service_contract` |
| `construction_services` | Orders | `construction_contract` |
| `advertising_marketing` | Orders | `advertising_contract_award_letter` |
| `software_purchase` | Orders | `purchase_agreement` |

> Any other purpose returns `purposeOfFund is not supported for CNY/CNH payouts`.

### 7.2 Everything documented about `merchant_settlement`
These are the only documented facts. Nothing else on any page refers to it.
- It is one of the 20 accepted CNY `purposeOfFund` values.
- Its `additionalPayoutDetails` shape is **Orders** (7.4): 1 to 10 orders, each with `orderedAt`, `item.name`, `item.quantity`, and `platform` holding `name` or `url`. Amounts are in CNY, and `amount` is required on every order when there is more than one.
- Its single required document type is **`merchant_agreement`**.
- If `merchant_agreement` is not attached to `POST /send`, the payout goes to `documents_required` and you upload it with `POST /payouts/documents-upload` (`type=merchant_agreement`).
- "Do not send a trade type. Fincra derives it from the purpose."
- **Not documented:** what a "merchant agreement" must contain, who signs it, whether one agreement can cover many payouts, what `item.name` / `platform` should hold for a settlement (as opposed to a goods purchase), and which `relationshipWithBeneficiary` value fits. Ask Fincra.

### 7.3 Salary shape (5 purposes)
```json
{
  "additionalPayoutDetails": {
    "payerOccupation": "information_technology",
    "payerIndustry": "software_development"
  }
}
```
> Both fields are required. Pick `payerOccupation` from the occupation list and `payerIndustry` from the industry list.
> Do not send `orders` with a salary purpose. The endpoint rejects the request.

(Both list links return **404**.)

### 7.4 Orders shape (15 trade purposes). "Send between 1 and 10 orders."
```json
{
  "additionalPayoutDetails": {
    "orders": [
      {
        "orderedAt": 1784544600000,
        "item": { "name": "LED display panels", "quantity": 250, "category": "electronics" },
        "platform": { "name": "Alibaba", "url": "https://hq-electronics.en.alibaba.com" },
        "logistics": { "company": "SF Express", "trackingNumber": "SF1234567890" }
      }
    ]
  }
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `orderedAt` | Yes | An ISO 8601 date, or the epoch time in milliseconds. |
| `item.name` | Yes | The goods or the service. |
| `item.quantity` | Yes | A whole number from 1 to 999. |
| `item.category` | No | An empty text is allowed. |
| `platform.name` or `platform.url` | Yes | `platform` is required. One of the two must hold a value. |
| `logistics.company` | No | The shipping company. |
| `logistics.trackingNumber` | No | The tracking number. |
| `amount` | See below | A positive number, in CNY. |

> Every order amount is in CNY. Send CNY whatever the source currency of the payout. The amounts describe what the counterparty receives, not what your wallet is debited.
> `amount` is optional on a single order, because the payout amount already covers it.
> `amount` is required on every order when you send more than one. The sum must always equal the payout amount in CNY, within half a cent.

This shape is JSON, while `POST /send` is multipart. On the wire, use the bracket form shown in 6.1: `additionalPayoutDetails[orders][0][item][name]=...`.

### 7.5 How documents are supplied
Payout documents are **uploaded as files (multipart)**. **No page documents a URL field for documents.**

**(a) Inline on `POST /send`**: one `files` array entry per document:

| Field | Required |
| --- | --- |
| `files[n][documentType]` | Yes |
| `files[n][file]` | Yes |

> Fincra subtracts the types you sent from the types the purpose needs.

| Result | Status | What happens |
| --- | --- | --- |
| Nothing missing | `processing` | Fincra sends the payout to the partner. |
| Something missing | `documents_required` | Fincra holds the payout. `documentsRequired` names each type. |

**(b) Later: `POST /payouts/documents-upload`** (base `https://sandboxapi.fincra.com` / `https://api.fincra.com`):
> Call `POST /payouts/documents-upload` while the status is `documents_required`. Upload one document for each call.
```shell
curl -X POST https://api.fincra.com/payouts/documents-upload \
  -H "api-key: $FINCRA_API_KEY" \
  -F "reference=PO-8f3a2c1d" \
  -F "type=payroll_schedule" \
  -F "name=July 2026 payroll schedule" \
  -F "files[file]=@payroll-schedule-july.pdf"
```
> When the last document arrives, Fincra moves the payout to `processing` and sends it to the partner.

Upload errors (all 422):

| Message | Cause |
| --- | --- |
| `Payout reference not found` | The reference does not exist. |
| `Document already uploaded for this payout` | The payout has every document. |
| `Document not required for this payout` | The purpose needs no document. |
| `Invalid document type. Allowed types: <list>` | `type` is not a known type. |
| `Document type '<type>' is not required for this payout. Required types: <list>` | The purpose does not need this type. |
| `Document of type '<type>' has already been uploaded for this payout` | You sent this type before. |

The reference page for the same operation (https://docs.fincra.com/reference/upload-payout-transaction-document) disagrees with the guide:
- path `POST /disbursements/payouts/documents-upload` (guide: `/payouts/documents-upload`)
- schema declared as `application/json`, with properties `name` (string, default `"Invoice"`), `type` (string), **`file`** (string, binary; guide: `files[file]`), `reference` (string, **required**)
- example 200 and 400 bodies are empty: `{}`

**File types and limits for payout documents: not documented.** JPEG/PNG/PDF is stated only for *sender* documents. The sandbox note ("Use a JPEG, a PNG or a PDF.") is in the general setup steps. No file-size limit is documented anywhere.

---

## 8. Webhooks

### 8.1 Setup
Source: https://docs.fincra.com/docs/setup-webhook
> Navigate to the `API keys and Webhook` Configuration tab on the `Account Settings` page. Paste the URL of your server endpoint in the designated `webhook` URL field. You can choose to generate a new `webhook` encryption key.
> You would also have to repeat this process on the live environment if previously done on sandbox, as the credentials are independent across environments.

Source: https://docs.fincra.com/docs/webhooks
> Create an endpoint on your server: This is where we will send HTTP POST requests with event data.
> It's recommended to acknowledge the webhook by responding with a 200 OK status code

Per-object override: `callbackUrl` on the sender, or "on the payout" (test values). No `callbackUrl` field appears in the `POST /send` field table, and "The endpoint rejects any field that the table above does not list". See section 12.

Retry policy, delivery timeout and source IPs: not documented.

### 8.2 Event names and payloads

**`sender.updated`** (https://docs.fincra.com/docs/china-payouts-create-a-sender):
```json
{
  "event": "sender.updated",
  "data": {
    "id": "sndr_tgqmdclpzz4hn6cq2wxyxjc",
    "status": "approved",
    "flags": ""
  }
}
```
> Read the sender with `GET /v1/senders/{id}` before you act on the event. Do not trust the body alone.

(The meaning of `flags` is not documented.)

**`counterparty.updated`** (https://docs.fincra.com/docs/china-payouts-create-a-counterpart):
```json
{
  "event": "counterparty.updated",
  "data": {
    "id": "cp_hkzx6drmqogyeiwzensmwrgs",
    "status": "active"
  }
}
```
> `status` is `active` or `failed`. Read the record before you act on the event.

**`payout.successful`** (https://docs.fincra.com/docs/payout-webhook; a GBP example, no China example exists):
```json
{
    "event": "payout.successful",
    "data": {
        "id": 14380,
        "amountCharged": 212000,
        "amountReceived": 500,
        "recipient": {
            "name": "Hassan Sarz",
            "accountNumber": "0124775489",
            "type": "individual",
            "email": "aa@aa.com"
        },
        "fee": 150,
        "rate": 0.0019,
        "paymentScheme": "fps",
        "paymentDestination": "bank_account",
        "sourceCurrency": "GBP",
        "destinationCurrency": "GBP",
        "status": "successful",
        "createdAt": "2022-04-02T21:23:44.000Z",
        "updatedAt": "2022-04-02T21:23:50.000Z",
        "reference": "bf2eb02e-39fe-490a-b933-63f8c4d42125",
        "customerReference": "4555r4554",// would be included if its passed at the point where payout was initiated
        "reason": "Payout was successful",
        "traceId": null,
        "valuedAt": "2022-04-03T21:23:50.000Z"
    }
}
```

**`payout.failed`** (same page):
```json
{
  "event": "payout.failed",
  "data": {
    "id": 14382,
    "amountCharged": 12150,
    "amountReceived": 12000,
    "recipient": {
      "name": "Hassan Sarz",
      "accountNumber": "0124775489",
      "type": "individual",
      "email": "aa@aa.com"
    },
    "fee": 150,
    "rate": 1,
    "paymentScheme": "fps",
    "paymentDestination": "bank_account",
    "sourceCurrency": "GBP",
    "destinationCurrency": "GBP",
    "status": "failed",
    "createdAt": "2022-02-21T03:51:53.000Z",
    "updatedAt": "2022-02-21T03:54:10.000Z",
    "reference": "9fd3f916-3b03-4bb2-af69-f42b64925919",
    "customerReference": "4555r4554",// would be included if its passed at the point where payout was initiated
    "reason": "Wrong beneficiary bank details",
    "traceId": null,
    "valuedAt": null
  }
}
```

Payout webhook fields (verbatim descriptions): `data.id` unique payout ID; `data.amountCharged` "total amount charged for the payout, including transaction fees"; `data.amountReceived` "amount received by the recipient after deducting fees"; `data.fee` "The fee charged for the transaction, specified in the destination currency"; `data.rate` "quoted exchange rate"; `data.status` "(e.g. successful, failed, pending, processing)"; `data.reference` unique payout reference; `data.reason` "A comment or description related to the transaction"; `data.customerReference`; `data.traceId` "transaction identifier recognized across Nigerian banks"; `data.valuedAt` "when the account holder receives the funds".

Only `payout.successful` and `payout.failed` are documented as payout event names. No event is documented for `documents_required`, `change_requested`, `cancelled`, `pending`, or the "acceptance webhook" mentioned on the test-values page.

### 8.3 Signature verification (exact algorithm)
Sources: https://docs.fincra.com/docs/validating-webhook, https://docs.fincra.com/docs/encryption

- **Header:** `signature` (Node: `req.headers['signature']`; PHP: `$_SERVER['HTTP_SIGNATURE']`)
- **Algorithm:** HMAC SHA-512, hex digest (lower-case, per the Java/vanilla examples)
- **Secret:** the merchant's **webhook secret key** ("Webhook Encryption Key" in the dashboard; one per environment)
- **Message hashed:** the JSON serialisation of the payload object `{ "event", "data" }`:
  > a payload refers to an object that comprises the event and data fields of the webhook notification. ... the webhook payload structure should remain encrypted and unmodified as received.
- **Comparison:** plain equality in the examples. Constant-time comparison is not mentioned.

Node (verbatim):
```javascript
import crypto from "crypto";

const encryptedData =  crypto
      .createHmac("SHA512", merchantWebhookSecretKey)
      .update(JSON.stringify(payload))
      .digest("hex");
const signatureFromWebhook = req.headers['signature'];

if(encryptedData === signatureFromWebhook) {
  console.log("process");
}
else {
  console.log("discard");
}
```
Python (verbatim excerpt):
```python
message = json.dumps(payload, separators=(',', ':')).encode("utf-8")
encrypted_data = hmac.new(key, message, hashlib.sha512).hexdigest()
signature = req.headers['signature'];
```
The docs hash a **re-serialised** object (`JSON.stringify(payload)` / compact `json.dumps`), not the raw request bytes. Re-serialising parsed JSON can change key order, whitespace, unicode escaping (Chinese names) and number formatting. **Whether to hash the raw body is not documented.** See section 12.

Alternative validation (https://docs.fincra.com/docs/setup-webhook):
> Query Transaction: Validate a webhook by querying the transaction using its reference to confirm its existence.

The China pages require reading the record (`GET /v1/senders/{id}`, `GET /v1/counterparties/{id}`, payout reference) before acting, whatever the signature result.

Whether `sender.updated` and `counterparty.updated` carry the same `signature` header is **not stated**. The validating page lists only "Payouts, Conversions, Virtual Account, and Collections".

---

## 9. Error codes for China payouts
Source: https://docs.fincra.com/docs/china-payouts-errors
> `POST /send` runs its checks in one order and stops at the first failure: the schema, then the counterparty, then the sender, then the documents.

### Counterparty errors
| HTTP | Message | `errorType` | Fix |
| --- | --- | --- | --- |
| 404 | `Counterparty not found: <id>` |  | The id does not belong to your business. Check the id. |
| 422 | `Counterparty <id> is pending verification and cannot be used for payouts.` | `COUNTERPARTY_PENDING_VERIFICATION` | The partner registration is not finished. Poll until `active`. Allow 48 hours. |
| 422 | `Counterparty <id> failed verification and cannot be used for payouts.` | `COUNTERPARTY_VERIFICATION_FAILED` | No partner accepted the account. Create a new counterparty. |
| 422 | `Counterparty <id> is blacklisted and cannot be used for payouts. Reason: <reason>` | `COUNTERPARTY_BLACKLISTED` | The block is one-way. Create a new counterparty. |
| 422 | `Counterparty is of type <A>, but the payout request is for type <B>.` | `COUNTERPARTY_TYPE_MISMATCH` | Send `paymentScheme=cnaps`. |
| 422 | `Counterparty <id> has neither an account number nor an IBAN.` |  | The record has no account number. Create a new counterparty. |
| 500 | `Unable to verify counterparty: <id>` |  | Retry with the same `customerReference`. |

```text
expected type = UPPERCASE(destinationCurrency + "_" + paymentScheme)
```
> `CNY` and `cnaps` give `CNY_CNAPS`. A missing `paymentScheme` gives `CNY_`, which matches nothing.

### Sender errors
| HTTP | Message | Fix |
| --- | --- | --- |
| 422 | `Invalid senderId provided for FCY payouts.` | The sender does not exist. Check the id. |
| 403 | `Invalid senderId provided for FCY payouts.` | The sender belongs to another business. |
| 403 | `Individual senders of Chinese nationality are not permitted for CNY payouts.` | See below. |
| 403 | `Sender is blacklisted from making transactions.` | The sender is on your block list. |
| 403 | `Sender is not approved to make transactions.` | The verification is not `approved`, or the sender is a local-currency sender. |

> Fincra rejects the payout when all three are true: the sender is an `individual`, the `countryOfOrigin` of the sender is `CN`, and the `entityType` of the counterparty is `individual`.
> CNY is the only currency that accepts an individual sender at all. USD, EUR and GBP return `Individual senders currently not supported for <CURRENCY> payout.`

### Schema errors
| Message | Cause |
| --- | --- |
| `"counterpartyId" is required` | You did not send `counterpartyId`. |
| `"business" length must be 24 characters long` | The business id is the wrong length. |
| `Purpose of fund is required` | You did not send `purposeOfFund`. |
| `"relationshipWithBeneficiary" is required` | You did not send the relationship. |
| `"<field>" is not allowed` | You sent a field the endpoint does not accept. |
| `"amount" must be an integer` | The source currency has no decimal places. |
| `"transactionId" is required` | `action` is `authenticate` and the transaction id is absent. |
| `Cannot continue, Duplicate Customer Reference Passed` | You used this `customerReference` before. |

### China payout errors
| Message | Cause |
| --- | --- |
| `purposeOfFund is required for CNY/CNH payouts` | You did not send `purposeOfFund`. |
| `purposeOfFund is not supported for CNY/CNH payouts` | The purpose is not one of the 20 CNY values. |
| `"additionalPayoutDetails" is required` | The trade details or the salary details are absent. |
| `"additionalPayoutDetails" is not allowed` | You sent the object on a payout that is not CNY. |
| `platform requires at least one of name or url` | An order has no platform name and no shop address. |
| `"amount" is required when there is more than one order` | You sent many orders and one has no amount. It is optional only on a single order. |
| `The sum of order amounts (<total>) must equal the payout amount (<amount>)` | Same-currency payout. The amounts do not add up. |
| `The sum of order amounts (<total>) must equal the amount the beneficiary receives (<amount> <currency>).` | Conversion. The amounts do not add up. Order amounts are in CNY, so calculate them from the destination amount of the quote. |
| `"orderedAt" must be a valid date or epoch-milliseconds timestamp` | Fincra cannot read the order date. |
| `"quantity" must be less than or equal to 999` | The item quantity is too large. |

### Counterparty creation errors (all 400, code `validation_error`)
| Message |
| --- |
| `address.country must be CN for CNY beneficiaries — CNAPS pays onshore Chinese accounts only` |
| `phone must be a valid Chinese mobile number for CNY beneficiaries (e.g. +8613800138000)` |
| `<field> must be in Chinese characters for CNY beneficiaries` |
| `document is required for individual CNY beneficiaries` |
| `document.type must be national_id for individual CNY beneficiaries` |
| `document.number is required for individual CNY beneficiaries` |
| `phone is required for individual CNY beneficiaries` |
| `name must be the registered Chinese legal name for CNY beneficiaries` |
| `registrationNumber is required for businesses incorporated in China` |
| `registrationNumber must be a valid 18-character Unified Social Credit Code for businesses incorporated in China` |
| `specialEconomicZone is required for businesses incorporated in China` |
| `counterparty already exists with the same account details` |

### Authentication errors
| HTTP | Code |
| --- | --- |
| 401 | `api_key_missing` |
| 401 | `api_key_invalid` |
| 401 | `invalid_ip_address` |
| 401 | `kyb_not_approved` |

Error **envelope** (the JSON keys that carry message / code / `errorType`) is not shown for these China errors. The only full error bodies in the docs are the IP one (`{success:false, error, errorType}`) and the auth fragments (`"message": ...`).

---

## 10. Sandbox test values
Source: https://docs.fincra.com/docs/china-payouts-test-values

> The sandbox does not call our payment partners or our identity partners. A built-in test partner answers instead.
> The sandbox validates a request exactly as production validates it, so a payload the sandbox accepts is a payload production accepts. The sandbox delivers your webhooks in the normal way.

Setup: sandbox key in `api-key` to `https://sandboxapi.fincra.com`. "Create a sender with `currencyClassification` set to `CURRENCY_CLASSIFICATION_FCY`. The sandbox verifies an FCY sender and an ALL sender only." "Use a JPEG, a PNG or a PDF. The sandbox does not read the file content".

### Sender outcome: the last character of `idNumber`
Individual:

| `idNumber` ends with | Final `verificationStatus` | What it exercises |
| --- | --- | --- |
| `1` | `rejected` | A declined check. The warning codes are `ID_DATA_MISMATCH` and `NAME_VERIFICATION_FAILED`. |
| `2` | `in_review` | A manual review. The warning code is `ADDRESS_MISMATCH`. |
| `3` | `approved` | An approval where the sanctions screen returns a politically-exposed-person hit. The internal risk rating becomes high, and you still receive `approved`. |
| Any other character | `approved` | A clean approval. Use this for your success path. |

Business:

| `idNumber` ends with | Final `verificationStatus` | What it exercises |
| --- | --- | --- |
| `1` | `rejected` | The company check is declined. |
| `2` | `in_review` | The company check needs a manual review. |
| `4` | `in_review` | The company passes, but a document is not readable. |
| Any other character | `approved` | A clean approval. |

> An identification number that ends with a letter is always approved. `RC1234567A` approves. Put the digit last: `RC1234A7` ends with `7` and approves, `RC1234A1` ends with `1` and is rejected.

### Payout outcome: last two decimals of the **destination amount**
| Amount ends with | Final status | Where it fails, and what you receive |
| --- | --- | --- |
| `.01` | `failed` | The partner accepts the payout, which then fails at settlement. You receive the acceptance webhook first, then the failure. |
| `.02` | `cancelled` | The partner accepts the payout, which is then cancelled at settlement. |
| `.03` | `processing` | The payout never settles. The status stays `processing` for about five minutes, then polling stops. |
| `.04` | `failed` | The partner rejects the payout at submission. You receive no acceptance webhook, only the failure. |
| `.05` | `failed` | Submission succeeds, then the partner rejects the payout at the acceptance step. |
| `.06` | `failed` | The China declaration is rejected. CNY and CNH only. |
| Any other value | `successful` | The payout settles normally. |

```json
{
  "amount": 250.01,
  "destinationCurrency": "CNY"
}
```
> The sandbox rounds to the nearest minor unit before it reads the scenario, so `250.015` becomes `250.02` and the payout is cancelled instead of settled.
> On a cross-currency payout the rate decides the destination amount, so you cannot control the decimal places and you get the default `successful`. Set the destination amount when you need a specific outcome.

How to "set the destination amount" on `POST /send` is not documented. The `/send` `amount` is "The amount in the source currency". Presumably this means a CNY→CNY payout, or a quote with `action: receive`, but neither is stated.

### China declaration step
> Fincra declares a CNY payout to the regulator before the payment. ... 1. You send the payout. The status becomes `processing`. 2. Fincra submits the declaration and waits for the outcome. 3. The partner accepts the payout, which then settles as the amount above specifies.

### Timings
| Step | Sandbox | Production |
| --- | --- | --- |
| An individual verification, from the last document to a final status | A few seconds | Minutes |
| A business verification | Under 10 seconds | Minutes to hours |
| A counterparty registration | Seconds | Minutes to 48 hours |
| A payout settlement | Seconds | Minutes to days |
| A payout that never settles, `.03` | About 5 minutes | 10 days |

### Webhooks in sandbox
| Event | Sent when |
| --- | --- |
| `sender.updated` | A verification reaches `approved`, `rejected` or `in_review`. |
| `counterparty.updated` | A registration completes, with a success or a failure. |
> A payout event follows your existing payout webhook configuration, which the sandbox does not change.

### Ten cases to run (verbatim)
| # | Case | Expected result |
| --- | --- | --- |
| 1 | A business sender whose `idNumber` ends in any digit except 1, 2 or 4, with all four documents. | `sender.updated` arrives with `approved`. |
| 2 | A business sender whose `idNumber` ends in `1`. | `rejected`. Then replace a document and confirm the sender returns to `pending`. |
| 3 | A business sender whose `idNumber` ends in `4`. | `in_review`. Confirm your code waits and does not treat it as a failure. |
| 4 | A Chinese business counterparty with a valid 18-character code. | `counterparty.updated` arrives with `active`. |
| 5 | A Chinese individual counterparty with a resident identity card number and a `+86` phone number. | `active`. |
| 6 | A counterparty name in Latin characters. | Rejected at creation with a validation error. |
| 7 | A `goods_purchase` payout with the invoice attached, destination amount ending `.00`. | `processing`, then `successful`. |
| 8 | A `payroll_salary` payout with one of the two documents. | `documents_required`, then `processing` after you upload the second. |
| 9 | A payout with a destination amount ending `.06`. | `failed`, with the China declaration as the reason. |
| 10 | A payout with a destination amount ending `.03`. | Stays `processing` for about five minutes. Confirm your code does not treat it as settled. |

> Also run three request-level failures: a payout with `paymentScheme` absent, three orders whose CNY amounts do not add up to the payout amount, and a repeated `customerReference`.

### What the sandbox cannot tell you (verbatim headings)
> Whether a real document passes. / Whether a real person or company passes screening. / A partner-specific rejection. / A real settlement time. / An exchange rate. You cannot trade a sandbox rate.

---

## 11. Older NGN payout endpoint shape (for contrast only)
Source: https://docs.fincra.com/docs/same-currency-payouts, https://docs.fincra.com/reference/initiate-payout

The older bank payout is `POST /disbursements/payouts` (reference page). It takes an inline `beneficiary` object (`firstName`, `lastName`, `accountHolderName`, `type`, `country`, `accountNumber`, `bankCode`, ...) and no sender or counterparty ids. Example request from the reference page (verbatim):
```json
{
  "business": "64f000000000000000000001",
  "sourceCurrency": "NGN",
  "destinationCurrency": "NGN",
  "amount": 5000,
  "description": "Payment for services",
  "paymentDestination": "bank_account",
  "customerReference": "payout-20260821-001",
  "beneficiary": {
    "firstName": "John",
    "lastName": "Doe",
    "accountHolderName": "John Doe",
    "type": "individual",
    "country": "NG",
    "accountNumber": "0123456789",
    "bankCode": "044"
  }
}
```
**Do not use this for China.** `POST /send` rejects `beneficiary` (6.1).

---

## 12. NOT DOCUMENTED / AMBIGUOUS. Confirm with Fincra before implementing

1. **Processing mode field.** The name and values of the Normal/Instant field on `POST /send` are not documented. The guide says to "Take the mode field name from the API reference for `POST /send`", but no `POST /send` reference page exists in the docs index. The field is required.
2. **No API reference for `POST /send`, `/global-payouts/v1/senders` or `/global-payouts/v1/counterparties`.** `reference/create-sender` returns 404. Full field types, lengths, optionality and response schemas exist only as guide examples.
3. **Sender optional fields.** `email`, `phone`, `callbackUrl` and the `address` sub-fields are shown in the example but not marked required or optional. Formats are not given.
4. **Create-counterparty response body** is never shown. `GET /v1/senders/{id}` and `GET /v1/counterparties/{id}` response bodies are not shown either. The success bodies of the sender document upload, the `PUT` replace and `POST .../blacklist` are not shown. The `PUT` request shape is not documented.
5. **Enum lists 404.** `industry` / `payerIndustry` (`reference/counterparty-industries`) and `payerOccupation` (`reference/payer-occupations`) are unavailable. Known values: `ecommerce_electronics`, `software_development`, `information_technology`. Only `not_applicable` is known for `specialEconomicZone`.
6. **`relationshipWithBeneficiary` enum** is not documented. Only `supplier` and `employee` are given as examples.
7. **Fees.** The rate card is per merchant ("Ask your account manager"). There are four cases (mode x business/individual). The fee amount, the fee currency, and whether it is added to or deducted from `amount` are not stated for `/send`. `feeBearer` exists only on the quote endpoint.
8. **NGN as source currency.** Only the guide example uses `sourceCurrency=NGN`. No page states that NGN→CNY is enabled. CNY is enabled "for each merchant one at a time". Which corridors your account has: "Ask us".
9. **FX quote for CNY.** A quote is required for a conversion, but the `POST /quotes/generate` reference enum for `destinationCurrency` does **not** include `CNY`, and its `paymentScheme` enum does **not** include `cnaps`. The required quote parameters for an NGN→CNY disbursement (`beneficiaryType`? `paymentScheme`?) are undocumented. Quotes expire after 30 seconds. The example quote reference format differs: `QTE-8842-XYZ` in the China guide, UUIDs in the reference.
10. **`amount` units on `/send`.** Major units vs minor units (naira vs kobo) are not stated. The only hint is `"amount" must be an integer` when "the source currency has no decimal places". Quote and webhook examples contain floats.
11. **Setting the destination amount.** The sandbox scenarios key off the destination amount, but `/send` takes the source amount. How to fix the destination amount (a `receive` quote? a CNY wallet?) is not documented.
12. **Document upload endpoint conflict.** The guide says `POST /payouts/documents-upload` with file field `files[file]`. The reference says `POST /disbursements/payouts/documents-upload` with field `file`, declared as JSON. The response bodies are `{}`.
13. **Payout document file types and limits** are not documented. JPEG/PNG/PDF is stated for sender documents only. No size limit is documented anywhere. No URL-based document field is documented.
14. **`merchant_settlement` specifics.** Beyond "Orders shape + `merchant_agreement` document", nothing is documented: agreement contents, reuse across payouts, what `item` / `platform` mean for a settlement, or the matching `relationshipWithBeneficiary`.
15. **Payout status endpoint for `/send` payouts.** Only the generic `GET /disbursements/payouts/reference/{ref}` and `/customer-reference/{ref}` exist, with non-China examples. Neither is stated to cover `/send` payouts or their CNY fields.
16. **Payout webhook events for China.** Only `payout.successful` and `payout.failed` are documented. No event names are given for `documents_required`, `change_requested`, `pending`, `cancelled`, or the "acceptance webhook" (test values, `.01`). There is no CNY webhook example. `cancelled` is missing from the China status table.
17. **Contradiction: payout webhooks in the sandbox.** *Before you begin* and *Send a payout* say "The sandbox sends no payout webhook". *Test values* says the sandbox "delivers your webhooks in the normal way" and describes acceptance and failure webhooks.
18. **Contradiction: `sender.updated` on `in_review`.** *Create a sender* says `in_review` "sends no event". *Test values* says the event fires on `approved`, `rejected` **or `in_review`**.
19. **`callbackUrl` on the payout.** *Test values* says you can set it "on the payout", but it is not in the `/send` field table, and `/send` "rejects any field that the table above does not list".
20. **Webhook signature input.** The docs hash `JSON.stringify(payload)` / compact `json.dumps` of the parsed `{event,data}`, not the raw body. Byte-exact rules (key order, unicode escaping of Chinese text, number format) are undocumented. Whether `sender.updated` and `counterparty.updated` are signed is not stated. Constant-time comparison is not mentioned. Retry policy, timeout and source IPs are not documented.
21. **The `flags` field** in `sender.updated` is not explained.
22. **Error envelope.** The JSON structure carrying `message` / `errorType` / `validation_error` for the China errors is not shown. Only the IP error shows `{success:false, error, errorType}`.
23. **IP allow-list error conflict.** It is documented both as 403 `ACCESS_DENIED` (IP page) and as 401 `invalid_ip_address` (China errors).
24. **`x-pub-key`.** The auth page says it is sent "when making api requests". No China sample sends it. Whether it is required on the China endpoints is not stated. No `x-business-id` header is documented anywhere; the business id is a body field.
25. **Limits, cut-off times, settlement times** are per merchant ("Ask your account manager"). The sandbox `.03` scenario implies a production non-final window of up to 10 days.
26. **Polling interval** for counterparty and sender status is not documented. Only "Stop after 48 hours and raise a support ticket" (counterparty) is given.
27. **CNH.** The error messages mention "CNY/CNH payouts", but no page documents CNH payouts.
