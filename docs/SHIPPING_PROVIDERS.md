# Shipping and logistics providers

Research date: **26 November 2026**. Every fact below comes from the provider's own website or published API documentation (links in each section). Where the documentation was silent, the table says "not documented". **No provider has been tested against its real API from this codebase yet, because no credentials exist.** The admin page shows "Successfully connected" only after a real connection test passes.

Admin: **Integrations → Shipping providers** (comparison, configuration, delivery zones) · **International freight** · **Shipments** (and Returns) · **Shipping & logistics** (finance and reports).

## Summary

| Provider | Public API | Sandbox | What the code does today | Status shown to admins |
|---|---|---|---|---|
| **Shipbubble** | Yes ([docs](https://docs.shipbubble.com)) | Yes (`sb_sandbox_` keys) | Full adapter: address validate, rates, label booking, cancel (scheduled shipments), tracking by order id, label document, signed webhooks, connection test | Requires API credentials |
| **GIG Logistics** | Partner API, docs public ([OpenAPI](https://dev-thirdpartynode.theagilitysystems.com/api-docs/) · saved in `docs/providers/gig-third-party-openapi.json`) | Yes (dev host, test merchant account) | Login (JWT cache), station list, connection test. Price/booking/tracking **not enabled**: request enum meanings and the tracking response are not documented | Requires business approval |
| **RUN Delivery** | Advertised, docs not published ([business page](https://rundeliverys.com/business)) | Unknown | Profile only | Requires private API access |
| **DHL Express (MyDHL API 3.4.1)** | Yes ([reference](https://developer.dhl.com/api-reference/dhl-express-mydhl-api) · spec saved in `docs/providers/`) | Test host + mock server | Rates (vendor booking only), tracking (polled), service-area check, connection test. Shipment booking and pickups documented but **not implemented** (need test credentials to verify label/customs payloads) | Requires business approval |
| **FedEx** | Yes ([developer portal](https://developer.fedex.com)) | Yes | OAuth token + connection test only. Rate/ship/track **not enabled**: FedEx serves Nigeria through Red Star Express and rates are USD; needs an account to confirm the NG service | Requires business approval |
| **Skyways Shipping** | None found ([site](https://skywaysshipping.com)) | — | Manual freight workflow | Not currently supported |
| **Aquantuo** | "Coming soon" ([e-commerce page](https://aquantuo.com/e-commerce)) | — | Manual freight workflow | Not currently supported |
| **Colala Logistics** | None found ([site](https://colalalogistics.com)) | — | Manual freight workflow | Not currently supported |
| **NIPOST** | None found | — | Profile only | Not currently supported |
| Sandbox carrier | Built in | — | Formula prices, test only. Refused in production unless `ALLOW_SANDBOX_SHIPPING=true` | Test simulator |

## Verified details

### Shipbubble
- Base `https://api.shipbubble.com/v1`, `Authorization: Bearer <key>`. Keys start `sb_sandbox_` or `sb_prod_`; the adapter refuses a key whose prefix doesn't match the configured mode.
- Endpoints used: `POST /shipping/address/validate` (→ `address_code`), `GET /shipping/labels/categories`, `POST /shipping/fetch_rates` (field is spelled `reciever_address_code` in the API; weight in kg, dimensions in cm; returns a `request_token` valid 7 days), `POST /shipping/labels`, `POST /shipping/labels/cancel/:order_id` (only before pickup), `GET /shipping/labels/list/:ids`.
- Webhook: `x-ship-signature` = HMAC-SHA512 of the raw body with the API key. Statuses `pending, confirmed, picked_up, in_transit, completed, cancelled`. Unknown statuses are ignored, never guessed.
- Ships only from the account's own country, so it's offered for NG → NG.
- Credentials: `apiKey`, `categoryId` (default package category).

### GIG Logistics
- Dev `https://dev-thirdpartynode.theagilitysystems.com`, prod `https://thirdpartynode.theagilitysystems.com` (prod host from GIG's official WooCommerce plugin).
- `POST /login {email, password}` → `access-token` header for later calls. 29 documented paths, including `/price`, `/capture/preshipment`, `/track/mobileShipment`, `/localstations/get` and `/intlShipment/inbound/*` (China/UK/US → NG).
- No webhooks, cancel, label or address-validation endpoints in the spec.
- Credentials: merchant `email`, `password` (issued by GIG).

### DHL Express
- Test `https://express.api.dhl.com/mydhlapi/test`, live `/mydhlapi`. HTTP Basic (API key and secret) plus required header `x-version: 3.4.1`.
- `GET /rates` (price taken from `totalPrice[currencyType=BILLC]`), `GET /shipments/{n}/tracking` (event codes mapped only where documented: PU, PL, DF, AR, CR, WC, OK, ND...), `GET /address-validate`.
- **DHL's terms forbid storing or modifying its rates**, so DHL is never shown at checkout or marked up; vendors see a live quote at booking.
- Credentials: `apiKey`, `apiSecret`, `accountNumber`.

### FedEx
- OAuth `POST /oauth/token` (client credentials, 1-hour token). Hosts `apis-sandbox.fedex.com` and `apis.fedex.com`. Rate, Ship, Track, Pickup and Address APIs are published. Address validation does not cover Nigeria; webhooks are a paid, US-only product.
- Credentials: `clientId`, `clientSecret`, `accountNumber`.

### China → Nigeria freight partners (Skyways, Aquantuo, Colala)
- All three run a Guangzhou warehouse, air and sea consolidation, Nigerian customs clearance and door delivery. None publishes an API. They are run through the **International freight** workflow: staff record receipts, consolidations, the partner's quote (exactly as quoted, with exclusions stated), each milestone and the partner's invoices. Nothing is estimated.

## How it fits together

- **Adapters**: `src/server/integrations/shipping/*`, registered in `registry.ts`. Methods: `getRates`, `createShipment`, `cancelShipment`, `getTracking`, `schedulePickup`, `generateLabel`, `validateAddress`, `parseWebhook`, `testConnection`. A capability is declared only when the method is implemented from documentation.
- **Checkout** (`services/shipping-rates.ts`): each seller's sub-order gets its own courier options, priced only from live provider rates plus the admin's markup (`feeBps` + `feeFixedMinor`). Options appear only when every product has weight and dimensions. The quote is tied to the cart, seller, delivery address and items; placing the order re-checks it and fails if it expired or the address changed. Strategy: cheapest / fastest / recommended / manual (Platform settings → `shippingSelection`). Sellers' own delivery prices stay available and are labelled "seller-set price".
- **Booking** (`services/shipping.ts`): the vendor books the customer's chosen quote (preselected). A unique idempotency key is reserved before calling the carrier, so a double submit can't buy two labels. Cancel and pickup are restricted to the vendor's own shipments.
- **Tracking**: carrier webhooks are signature-checked per adapter; carriers without webhooks are polled by the `shipment-tracking-poll` job. Only documented carrier statuses change our status.
- **Freight** (`services/freight.ts`): seller → origin warehouse → received (weighed) → consolidation (air/sea) → booked → departed → arrived → customs → cleared → last mile → delivered. Final delivery confirmed by staff counts as ADMIN evidence for settlement.
- **Returns** (`services/shipping-returns.ts`): the customer requests a return within `returnWindowDays` of delivery and before settlement; the seller (or staff) approves; the customer adds return tracking; receipt triggers the ledger refund. An open return blocks settlement.
- **Customs and duties**: no duty or tax is calculated. Customers are told that amounts come from the Nigeria Customs Service or the carrier.

## Enabling a provider

1. Get the business account and API credentials from the provider (links above).
2. Admin → Integrations → Shipping providers → Configuration: enter the credentials (stored encrypted; never shown back), choose test or live mode, and click **Test connection**.
3. Set priority, weight limits, markup, default and delivery zones, then switch it on.
4. In production, check that the Sandbox carrier is **off** and `ALLOW_SANDBOX_SHIPPING` is unset.
5. Book one real test shipment per route in the provider's sandbox before taking live orders. Do not make live bookings without written approval.
