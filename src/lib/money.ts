/**
 * Money helpers. All amounts are integer minor units (kobo) held as bigint.
 * Never convert to floating point for arithmetic; Number() is only used for display.
 */
export type Minor = bigint;

export const CURRENCY = "NGN";

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatMoney(minor: bigint | number | string, opts: { kobo?: boolean } = {}): string {
  const v = BigInt(minor);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const naira = abs / 100n;
  const kobo = abs % 100n;
  // Format the naira part as an integer to avoid float rounding, then append kobo if needed.
  const whole = ngn.format(Number(naira)).replace(/\.00$/, "");
  const out = kobo === 0n && !opts.kobo ? whole : `${whole}.${kobo.toString().padStart(2, "0")}`;
  return negative ? `-${out}` : out;
}

/** Parse a user-entered naira amount ("12,500.50") into kobo. Returns null if invalid. */
export function parseNairaToMinor(input: string): bigint | null {
  const s = input.replace(/[,\s₦]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [n, k = ""] = s.split(".");
  return BigInt(n) * 100n + BigInt(k.padEnd(2, "0"));
}

export function minorToInput(minor: bigint | null | undefined): string {
  if (minor == null) return "";
  const n = minor / 100n;
  const k = minor % 100n;
  return k === 0n ? n.toString() : `${n}.${k.toString().padStart(2, "0")}`;
}

/** value * bps / 10000, rounded half-up. bps: 1000 = 10%. */
export function applyBps(value: bigint, bps: number): bigint {
  if (value <= 0n || bps <= 0) return 0n;
  return (value * BigInt(bps) + 5000n) / 10000n;
}

/**
 * Split `total` across `weights` proportionally using the largest-remainder method,
 * so the parts always sum exactly to `total`.
 */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n || total === 0n) return weights.map(() => 0n);
  const raw = weights.map((w, i) => ({ i, q: (total * w) / sum, r: (total * w) % sum }));
  let remaining = total - raw.reduce((a, b) => a + b.q, 0n);
  const order = [...raw].sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  const out = raw.map((x) => x.q);
  for (const x of order) {
    if (remaining <= 0n) break;
    out[x.i] += 1n;
    remaining -= 1n;
  }
  return out;
}

export const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
export const min = (a: bigint, b: bigint) => (a < b ? a : b);
export const max = (a: bigint, b: bigint) => (a > b ? a : b);
