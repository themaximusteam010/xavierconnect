import type { ShippingAdapter } from "../types";

export const dhlExpress: ShippingAdapter = {
  key: "dhl-express",
  name: "DHL Express",
  kind: "SHIPPING",
  capabilities: [],
  status: "NOT_IMPLEMENTED",
  routes: [],
  docsUrl: "https://developer.dhl.com/",
  notes: "Candidate for China→Nigeria and other international routes (rates, shipments, labels, tracking, customs). Not integrated: requires a DHL Express account, API credentials and verification of the current MyDHL API documentation.",
  credentialFields: [],
};

export const nipost: ShippingAdapter = {
  key: "nipost",
  name: "NIPOST",
  kind: "SHIPPING",
  capabilities: [],
  status: "NOT_IMPLEMENTED",
  routes: [],
  notes: "Nigerian postal service. No public API documentation was found; integration requires a direct agreement and technical documentation from NIPOST.",
  credentialFields: [],
};
