/** Countries vendors may register from. Payout availability is decided per PayoutCorridor, not here. */
export const VENDOR_COUNTRIES = [
  { code: "NG", name: "Nigeria", currency: "NGN", phonePrefix: "+234", routing: "NUBAN" },
  { code: "CN", name: "China", currency: "CNY", phonePrefix: "+86", routing: "CNAPS" },
  { code: "GH", name: "Ghana", currency: "GHS", phonePrefix: "+233", routing: "SWIFT" },
  { code: "KE", name: "Kenya", currency: "KES", phonePrefix: "+254", routing: "SWIFT" },
  { code: "ZA", name: "South Africa", currency: "ZAR", phonePrefix: "+27", routing: "SWIFT" },
  { code: "GB", name: "United Kingdom", currency: "GBP", phonePrefix: "+44", routing: "SORT_CODE" },
  { code: "US", name: "United States", currency: "USD", phonePrefix: "+1", routing: "ABA" },
] as const;

export type CountryCode = (typeof VENDOR_COUNTRIES)[number]["code"];
export const countryByCode = (c: string | null | undefined) => VENDOR_COUNTRIES.find((x) => x.code === c);
export const countryName = (c: string | null | undefined) => countryByCode(c)?.name ?? c ?? "—";
export const SUPPORTED_CURRENCIES = ["NGN", "CNY", "USD", "EUR", "GBP", "GHS", "KES", "ZAR"] as const;

/** International phone format check (E.164-ish) for non-Nigerian vendors. */
export const isIntlPhone = (s: string) => /^\+?[1-9]\d{6,14}$/.test(s.replace(/[\s()-]/g, ""));
