/**
 * Fixed-window rate limiter. In-memory per process; adequate for a single instance.
 * For multiple instances, back this with Redis (REDIS_URL) — see docs/SECURITY_PLAN.md.
 */
import { headers } from "next/headers";

const buckets = new Map<string, { count: number; reset: number }>();

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function rateLimit(action: string, limit: number, windowSec: number, key?: string) {
  const id = `${action}:${key ?? (await clientIp())}`;
  const now = Date.now();
  const b = buckets.get(id);
  if (!b || b.reset < now) {
    buckets.set(id, { count: 1, reset: now + windowSec * 1000 });
    return true;
  }
  b.count++;
  if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  return b.count <= limit;
}
