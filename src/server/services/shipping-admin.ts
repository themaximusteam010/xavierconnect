/** Admin view-model helpers for shipping providers (ShippingAdminService). */
import type { IntegrationProvider } from "@prisma/client";
import type { ShippingAdapter } from "@/server/integrations/types";

export type IntegrationStatus =
  | "Successfully connected" | "Connection failed" | "Available for integration" | "Requires business approval"
  | "Requires API credentials" | "Requires private API access" | "Not currently supported" | "Test simulator";

/** Connected/failed only ever come from a real connection test against the provider. */
export function integrationStatus(a: ShippingAdapter, row: IntegrationProvider | null): IntegrationStatus {
  if (a.status === "SANDBOX_SIMULATOR") return "Test simulator";
  if (row?.lastCheckOk === true && row.credentialsEnc) return "Successfully connected";
  if (row?.lastCheckOk === false && row.credentialsEnc) return "Connection failed";
  if (a.profile.baseStatus === "NOT_SUPPORTED") return "Not currently supported";
  if (a.profile.baseStatus === "REQUIRES_PRIVATE_API") return "Requires private API access";
  if (!row?.credentialsEnc && a.credentialFields.length) return a.profile.baseStatus === "REQUIRES_BUSINESS_APPROVAL" ? "Requires business approval" : "Requires API credentials";
  return "Available for integration";
}

export const STATUS_TONE: Record<IntegrationStatus, "success" | "danger" | "warning" | "info" | "neutral"> = {
  "Successfully connected": "success", "Connection failed": "danger", "Available for integration": "info", "Requires business approval": "warning",
  "Requires API credentials": "warning", "Requires private API access": "neutral", "Not currently supported": "neutral", "Test simulator": "info",
};

export const CATEGORY_LABEL: Record<string, string> = { AGGREGATOR: "Aggregator", NG_COURIER: "Nigerian courier", INTL_EXPRESS: "International express", CN_NG_FREIGHT: "China → Nigeria freight", TEST: "Test" };
