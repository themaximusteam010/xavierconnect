/**
 * FedEx — official APIs (developer.fedex.com). Verified 26 Nov 2026:
 *   OAuth: POST /oauth/token (application/x-www-form-urlencoded) grant_type=client_credentials&client_id&client_secret;
 *          hosts https://apis-sandbox.fedex.com and https://apis.fedex.com; tokens expire after 3600 s; no CORS (server-only)
 *   Rate POST /rate/v1/rates/quotes · Ship POST /ship/v1/shipments, PUT /ship/v1/shipments/cancel · Track POST /track/v1/trackingnumbers
 *   Pickup /pickup/v1/pickups · Address validation POST /address/v1/addresses/resolve (Nigeria not in the supported list)
 *   Webhooks ("Advanced Integrated Visibility") are paid and "only available for US accounts" → polling for Nigeria.
 *   FedEx Nigeria: direct presence since Dec 2022, with Red Star Express as service provider; rates billed in USD since Aug 2024.
 * Implemented: OAuth + connection test. Rate/ship/track request and response bodies must be confirmed against the
 * sandbox (FedEx publishes them in the developer portal JSON schemas) before they are enabled.
 */
import { providerFetch } from "../http";
import type { ProviderContext, ShippingAdapter } from "../types";

const HOSTS = { SANDBOX: "https://apis-sandbox.fedex.com", LIVE: "https://apis.fedex.com" } as const;
const tokens = new Map<string, { token: string; exp: number }>();

export async function fedexToken(ctx: ProviderContext) {
  const { clientId, clientSecret } = ctx.credentials;
  if (!clientId || !clientSecret) throw new Error("FedEx API key (client ID) and secret key are not configured");
  const k = `${ctx.mode}:${clientId}`;
  const hit = tokens.get(k);
  if (hit && hit.exp - 60_000 > Date.now()) return hit.token;
  const r = await providerFetch<{ access_token: string; expires_in: number }>("fedex", "oauth.token", `${HOSTS[ctx.mode]}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
  });
  tokens.set(k, { token: r.access_token, exp: Date.now() + r.expires_in * 1000 });
  return r.access_token;
}

export const fedex: ShippingAdapter = {
  key: "fedex",
  name: "FedEx",
  kind: "SHIPPING",
  capabilities: [],
  status: "AWAITING_PARTNERSHIP",
  routes: [],
  docsUrl: "https://developer.fedex.com/api/en-us/home.html",
  notes: "Documented APIs for rates, shipping/labels, cancellation, tracking and pickups; needs a FedEx account (Nigeria served via Red Star Express, rates in USD). OAuth connection test is implemented; other calls are enabled after confirming bodies in the FedEx sandbox. Webhooks are US-only, so tracking would be polled.",
  credentialFields: [
    { name: "clientId", label: "API key (client ID)", secret: false },
    { name: "clientSecret", label: "Secret key (client secret)", secret: true },
    { name: "accountNumber", label: "FedEx account number", secret: false },
  ],
  profile: {
    category: "INTL_EXPRESS", countries: ["*"], scope: ["INTERNATIONAL", "IMPORT"], freightModes: ["AIR"],
    api: "PUBLIC", sandbox: "apis-sandbox.fedex.com with sandbox project credentials",
    businessAccount: "FedEx account (Nigeria: via FedEx/Red Star Express) and a FedEx developer project",
    credentialsNote: "API key + secret key (OAuth client credentials) and the FedEx account number",
    supports: { quote: "YES", booking: "YES", tracking: "YES", webhooks: "NO", labels: "YES", pickup: "YES", returns: "UNVERIFIED", addressValidation: "NO", cancel: "YES" },
    baseStatus: "REQUIRES_BUSINESS_APPROVAL", complexity: "HIGH",
    remaining: ["Open a FedEx account usable from Nigeria (Red Star Express) and create a developer project", "Enter sandbox keys and run Test connection", "Confirm rate/ship/track JSON bodies in the sandbox, then enable them (USD rates need an admin FX rule before checkout)"],
    sources: [
      { label: "Authorization API", url: "https://developer.fedex.com/api/en-us/catalog/authorization/v1/docs.html" },
      { label: "Rate API", url: "https://developer.fedex.com/api/en-us/catalog/rate/v1/docs.html" },
      { label: "Track API", url: "https://developer.fedex.com/api/en-us/catalog/track/v1/docs.html" },
      { label: "FedEx Nigeria", url: "https://www.fedex.com/en-ng/home.html" },
    ],
  },
  async testConnection(ctx) {
    await fedexToken(ctx);
    return { ok: true, message: `FedEx OAuth token issued (${ctx.mode === "LIVE" ? "production" : "sandbox"}).` };
  },
};
