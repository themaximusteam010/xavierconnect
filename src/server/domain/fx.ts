/**
 * Exact FX arithmetic on integer minor units. Rates are decimal strings (as quoted by a provider)
 * scaled to 1e12 and applied with bigint maths — no floating point anywhere.
 * Converted amounts round DOWN so the platform never promises more than the quote delivers.
 */
const SCALE = 12;
const SCALE_N = 10n ** BigInt(SCALE);

export function parseRate(rate: string): bigint {
  const s = rate.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid FX rate "${rate}"`);
  const [i, f = ""] = s.split(".");
  if (f.length > SCALE) throw new Error("FX rate has too many decimal places");
  const scaled = BigInt(i) * SCALE_N + BigInt(f.padEnd(SCALE, "0"));
  if (scaled === 0n) throw new Error("FX rate must be positive");
  return scaled;
}

export function formatRate(scaled: bigint): string {
  const i = scaled / SCALE_N;
  const f = (scaled % SCALE_N).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return f ? `${i}.${f}` : `${i}`;
}

/** Convert source minor units to target minor units (both currencies with 2 decimal places). */
export function convertMinor(sourceMinor: bigint, rate: string, sourceDecimals = 2, targetDecimals = 2): bigint {
  if (sourceMinor < 0n) throw new Error("negative amount");
  const r = parseRate(rate);
  const adj = 10n ** BigInt(Math.abs(targetDecimals - sourceDecimals));
  let v = (sourceMinor * r) / SCALE_N;
  v = targetDecimals >= sourceDecimals ? v * adj : v / adj;
  return v;
}

export const CURRENCY_DECIMALS: Record<string, number> = { NGN: 2, CNY: 2, USD: 2, EUR: 2, GBP: 2, GHS: 2, KES: 2, ZAR: 2 };
