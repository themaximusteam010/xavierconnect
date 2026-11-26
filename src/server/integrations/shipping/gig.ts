/**
 * GIG Logistics — third-party API ("GIG THIRD PARTY API 1.0.0"). Sources (fetched 26 Nov 2026):
 *   - OpenAPI spec published at https://dev-thirdpartynode.theagilitysystems.com/docs/ (copy: docs/providers/gig-third-party-openapi.json)
 *   - GIG's official WordPress plugin page (https://wordpress.org/plugins/gig-logistics-delivery/): test host
 *     https://dev-thirdpartynode.theagilitysystems.com/ , production host https://thirdpartynode.theagilitysystems.com/ ,
 *     requires "A GIG Logistics merchant account. API credentials from your GIG Logistics account."
 * Verified from the spec: POST /login {email,password} → data.data["access-token"] (JWT) + UserChannelCode; every other
 * call sends header `access-token`. GET /localstations/get lists Nigerian stations.
 * Documented but NOT enabled here: POST /price (needs station IDs + GPS coordinates; enum meanings of VehicleType,
 * PickUpOptions, ShipmentType are not documented), POST /capture/preshipment, GET /track/mobileShipment (response
 * example is empty, so statuses can't be mapped), and China→Nigeria inbound /intlShipment/inbound/*. No webhooks,
 * cancel, label or address-validation endpoints exist in the spec. These are enabled only after confirming them in
 * GIG's test environment with merchant credentials.
 */
import { providerFetch } from "../http";
import type { ProviderContext, ShippingAdapter } from "../types";

const HOSTS = { SANDBOX: "https://dev-thirdpartynode.theagilitysystems.com", LIVE: "https://thirdpartynode.theagilitysystems.com" } as const;
const tokens = new Map<string, { token: string; exp: number }>();

function jwtExp(token: string) {
  try { return (JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp as number) * 1000; } catch { return Date.now() + 10 * 60_000; }
}

export async function gigToken(ctx: ProviderContext) {
  const { email, password } = ctx.credentials;
  if (!email || !password) throw new Error("GIG Logistics merchant email and password are not configured");
  const cacheKey = `${ctx.mode}:${email}`;
  const hit = tokens.get(cacheKey);
  if (hit && hit.exp - 60_000 > Date.now()) return hit.token;
  const r = await providerFetch<{ success?: boolean; data?: { data?: Record<string, unknown> } }>("gig-logistics", "login", `${HOSTS[ctx.mode]}/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const token = r.data?.data?.["access-token"];
  if (typeof token !== "string") throw new Error("GIG did not return an access token");
  tokens.set(cacheKey, { token, exp: jwtExp(token) });
  return token;
}

export async function gigStations(ctx: ProviderContext) {
  const token = await gigToken(ctx);
  const r = await providerFetch<{ data?: { data?: { StationId: number; StationName: string; StationCode: string; StateName: string }[] } }>("gig-logistics", "stations.list", `${HOSTS[ctx.mode]}/localstations/get`, { method: "GET", headers: { "access-token": token } });
  return r.data?.data ?? [];
}

export const gigLogistics: ShippingAdapter = {
  key: "gig-logistics",
  name: "GIG Logistics",
  kind: "SHIPPING",
  capabilities: [],
  status: "AWAITING_PARTNERSHIP",
  routes: [],
  docsUrl: "https://dev-thirdpartynode.theagilitysystems.com/docs/",
  notes: "Published API covers quotes, bookings, tracking and China/UK/US → Nigeria inbound imports, but needs a GIG merchant account. Connection test (login) and station list are implemented; quotes/bookings/tracking are switched on only after confirming field meanings in GIG's test environment.",
  credentialFields: [
    { name: "email", label: "Merchant login email", secret: false },
    { name: "password", label: "Merchant API password", secret: true },
  ],
  profile: {
    category: "NG_COURIER", countries: ["NG", "CN", "GB", "US"], scope: ["DOMESTIC", "NATIONWIDE", "INTERNATIONAL", "IMPORT"], freightModes: ["ROAD", "AIR"],
    api: "PARTNER", sandbox: "Test host dev-thirdpartynode.theagilitysystems.com (merchant test credentials)",
    businessAccount: "GIG Logistics merchant (e-commerce) account; API credentials issued by GIG",
    credentialsNote: "Email + password → /login returns an access-token header value",
    supports: { quote: "YES", booking: "YES", tracking: "YES", webhooks: "NO", labels: "NO", pickup: "VIA_BOOKING", returns: "MANUAL", addressValidation: "NO", cancel: "NO" },
    baseStatus: "REQUIRES_BUSINESS_APPROVAL", complexity: "HIGH",
    remaining: [
      "Open a GIG Logistics merchant account and request API credentials (giglogistics.com/developer → Reach out)",
      "Run Test connection with test credentials",
      "Confirm in the test environment: meaning of VehicleType / PickUpOptions / ShipmentType, weight units, tracking response format",
      "Then enable price, preshipment and tracking (polling — GIG has no webhooks) for domestic and China→Nigeria inbound",
    ],
    sources: [
      { label: "Developer page", url: "https://giglogistics.com/developer/" },
      { label: "API spec (Swagger)", url: "https://dev-thirdpartynode.theagilitysystems.com/docs/" },
      { label: "Official plugin (hosts, requirements)", url: "https://wordpress.org/plugins/gig-logistics-delivery/" },
    ],
  },
  async testConnection(ctx) {
    await gigToken(ctx);
    const stations = await gigStations(ctx);
    return { ok: true, message: `Logged in to GIG (${ctx.mode === "LIVE" ? "production" : "test"}). ${stations.length} Nigerian stations returned.` };
  },
};
