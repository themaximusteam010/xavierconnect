/**
 * Providers with no usable public API (verified 26 Nov 2026 from their official sites). They are registered so admins
 * see them in the comparison, and freight partners can still be used through the manual freight workflow
 * (warehouse receipts, consolidations, partner quotes and invoices entered by staff).
 */
import type { ShippingAdapter, ShippingProfile } from "../types";

const none = (over: Partial<ShippingProfile> & Pick<ShippingProfile, "category" | "countries" | "scope" | "freightModes" | "businessAccount" | "remaining" | "sources">): ShippingProfile => ({
  api: "NONE", sandbox: "none published", credentialsNote: "No API credentials exist today",
  supports: { quote: "MANUAL", booking: "MANUAL", tracking: "MANUAL", webhooks: "NO", labels: "NO", pickup: "MANUAL", returns: "MANUAL", addressValidation: "NO", cancel: "MANUAL" },
  baseStatus: "REQUIRES_PRIVATE_API", complexity: "HIGH", ...over,
});
const base = (key: string, name: string, notes: string, profile: ShippingProfile, docsUrl?: string): ShippingAdapter => ({
  key, name, kind: "SHIPPING", capabilities: [], status: "AWAITING_PARTNERSHIP", routes: [], notes, docsUrl, credentialFields: [], profile,
});

export const runDelivery = base("run-delivery", "RUN Delivery",
  "Last-mile and interstate delivery in Nigeria. Its business page advertises an API (create/cancel orders, estimate charges, status updates) but no documentation is published; access must be requested.",
  none({
    category: "NG_COURIER", countries: ["NG"], scope: ["DOMESTIC", "NATIONWIDE", "INTERNATIONAL"], freightModes: ["ROAD"], api: "PRIVATE",
    supports: { quote: "UNVERIFIED", booking: "UNVERIFIED", tracking: "UNVERIFIED", webhooks: "UNVERIFIED", labels: "NO", pickup: "UNVERIFIED", returns: "NO", addressValidation: "NO", cancel: "UNVERIFIED" },
    businessAccount: "RUN business account; API access on request", complexity: "MEDIUM",
    remaining: ["Contact RUN Delivery (rundeliverys.com/business) for API documentation, test credentials and webhook signing", "Build the adapter from their documentation"],
    sources: [{ label: "Business / API page", url: "https://rundeliverys.com/business" }, { label: "Interstate delivery", url: "https://rundeliverys.com/interstate-delivery" }],
  }), "https://rundeliverys.com/business");

export const nipost = base("nipost", "NIPOST",
  "Nigerian postal service. No public API documentation was found; integration needs a direct agreement and technical documentation.",
  none({ baseStatus: "NOT_SUPPORTED", category: "NG_COURIER", countries: ["NG"], scope: ["DOMESTIC", "NATIONWIDE", "INTERNATIONAL"], freightModes: ["ROAD", "AIR"], businessAccount: "Direct agreement with NIPOST", remaining: ["Request API/EDI documentation from NIPOST"], sources: [{ label: "NIPOST", url: "https://www.nipost.gov.ng/" }] }));

export const skyways = base("skyways", "Skyways Shipping",
  "China → Nigeria forwarder: Guangzhou warehouse, consolidation, air (≈1 week; economy ≈2 weeks), sea (45–60 days), Nigerian customs clearance and door delivery; tracking only in its own web app. No API found.",
  none({
    baseStatus: "NOT_SUPPORTED", category: "CN_NG_FREIGHT", countries: ["CN", "NG"], scope: ["IMPORT"], freightModes: ["AIR", "SEA"],
    businessAccount: "Customer account at app.skywaysshipping.com; warehouse code assigned per customer",
    remaining: ["Agree a business account and ask whether a partner API, EDI or webhook feed exists", "Until then: use the manual freight workflow (staff record receipts, consolidations, partner quotes and milestones)"],
    sources: [{ label: "Website", url: "https://skywaysshipping.com" }, { label: "Contact", url: "https://skywaysshipping.com/contact" }],
  }), "https://skywaysshipping.com");

export const aquantuo = base("aquantuo", "Aquantuo",
  "Shipping to Africa from the US, UK, Dubai, China, Canada and South Korea with customs clearance and door delivery. Its e-commerce page lists an API integration suite as “Coming Soon”.",
  none({
    baseStatus: "NOT_SUPPORTED", category: "CN_NG_FREIGHT", countries: ["CN", "NG", "US", "GB"], scope: ["IMPORT"], freightModes: ["AIR", "SEA"],
    businessAccount: "Aquantuo business account", remaining: ["Join the API waitlist / ask for partner access", "Until then: manual freight workflow"],
    sources: [{ label: "E-commerce (API coming soon)", url: "https://aquantuo.com/e-commerce" }],
  }), "https://aquantuo.com");

export const colala = base("colala", "Colala Logistics",
  "China → Nigeria: Guangzhou warehouse with shipping marks, LCL and full-container sea freight, air cargo via Main Service Logistics, Nigerian customs clearance, branches in Lagos, Onitsha and Abuja. No API or online tracking found.",
  none({
    baseStatus: "NOT_SUPPORTED", category: "CN_NG_FREIGHT", countries: ["CN", "NG"], scope: ["IMPORT"], freightModes: ["AIR", "SEA"],
    businessAccount: "Customer account with an assigned shipping mark", remaining: ["Ask for a partner integration (API/EDI/status emails)", "Until then: manual freight workflow"],
    sources: [{ label: "Website", url: "https://colalalogistics.com" }, { label: "Request a quote", url: "https://colalalogistics.com/request-quote/" }],
  }), "https://colalalogistics.com");
