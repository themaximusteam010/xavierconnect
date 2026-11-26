import type { DbClient } from "@/server/db";

export const SETTING_DEFAULTS = {
  taxBps: 0, // VAT collected at checkout (0 by default; set 750 for 7.5% VAT)
  settlementHoldDays: 3, // days after verified delivery before earnings become withdrawable
  vendorClaimHoldDays: 14, // when the only evidence is the vendor's own "delivered" claim
  minPayoutMinor: "500000", // ₦5,000
  reservationMinutes: 30, // how long unpaid orders hold stock
  downloadMaxCount: 5,
  downloadExpiryDays: 30,
  msgViolationWindowDays: 30, // confirmed messaging violations counted over this window
  msgRestrictAfter: 3, // confirmed violations before a temporary messaging restriction
  msgRestrictHours: 24,
  msgReviewAfter: 5, // confirmed violations before the account is flagged for administrative review
  msgBlockedRetentionDays: 90, // blocked message text and flagged files are purged after this
  shippingSelection: "RECOMMENDED", // CHEAPEST | FASTEST | RECOMMENDED | MANUAL — which courier options checkout shows/preselects
  checkoutQuoteMinutes: 30, // how long a courier price shown at checkout stays valid
  returnWindowDays: 7, // days after delivery a customer can request a return (before the seller is paid)
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting<K extends SettingKey>(db: DbClient, key: K): Promise<(typeof SETTING_DEFAULTS)[K]> {
  const row = await db.platformSetting.findUnique({ where: { key } });
  return (row?.value as (typeof SETTING_DEFAULTS)[K]) ?? SETTING_DEFAULTS[key];
}
