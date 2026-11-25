/** Date-range presets for admin filters. Times are Africa/Lagos (UTC+1, no DST). */
export const PRESETS = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"],
  ["month", "This month"], ["prev_month", "Previous month"], ["custom", "Custom range"],
] as const;

const OFFSET = 3600_000;
const lagosMidnight = (d: Date) => new Date(Math.floor((d.getTime() + OFFSET) / 864e5) * 864e5 - OFFSET);

export interface Range { from: Date; to: Date; preset: string; label: string; days: number }

export function resolveRange(sp: { range?: string; from?: string; to?: string }, fallback = "30d"): Range {
  const now = new Date();
  const today = lagosMidnight(now);
  const preset = PRESETS.some(([k]) => k === sp.range) ? sp.range! : fallback;
  let from: Date, to: Date;
  switch (preset) {
    case "today": from = today; to = now; break;
    case "yesterday": from = new Date(today.getTime() - 864e5); to = today; break;
    case "7d": from = new Date(today.getTime() - 6 * 864e5); to = now; break;
    case "90d": from = new Date(today.getTime() - 89 * 864e5); to = now; break;
    case "month": { const l = new Date(now.getTime() + OFFSET); from = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1) - OFFSET); to = now; break; }
    case "prev_month": { const l = new Date(now.getTime() + OFFSET); from = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth() - 1, 1) - OFFSET); to = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1) - OFFSET); break; }
    case "custom": {
      const f = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? new Date(`${sp.from}T00:00:00+01:00`) : new Date(today.getTime() - 29 * 864e5);
      const t = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? new Date(new Date(`${sp.to}T00:00:00+01:00`).getTime() + 864e5) : now;
      from = f; to = t > f ? t : new Date(f.getTime() + 864e5); break;
    }
    default: from = new Date(today.getTime() - 29 * 864e5); to = now;
  }
  const label = preset === "custom" ? `${fmt(from)} – ${fmt(new Date(to.getTime() - 1))}` : PRESETS.find(([k]) => k === preset)![1];
  return { from, to, preset, label, days: Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 864e5)) };
}

const fmt = (d: Date) => d.toLocaleDateString("en-NG", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });

/** Day buckets (Lagos) between from and to, for charts. */
export function dayBuckets(r: Range) {
  const out: { key: string; label: string }[] = [];
  for (let t = lagosMidnight(r.from).getTime(); t < r.to.getTime(); t += 864e5) {
    const d = new Date(t + OFFSET);
    out.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString("en-NG", { day: "numeric", month: "short", timeZone: "UTC" }) });
  }
  return out;
}
