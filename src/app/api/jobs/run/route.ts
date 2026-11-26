import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { expireUnpaidOrders } from "@/server/services/orders";
import { releaseSettlements } from "@/server/services/finance";
import { retryDueWebhooks } from "@/server/services/webhooks";
import { runMonitoring } from "@/server/services/monitoring";
import { pollActiveShipments } from "@/server/services/shipping";
import { purgeModerationRetention } from "@/server/services/moderation-admin";
import { runReconciliation } from "@/server/services/reconciliation";

/**
 * Scheduled maintenance (Vercel Cron sends GET with Authorization: Bearer $CRON_SECRET).
 * Each step is idempotent and isolated so one failure doesn't stop the others.
 */
async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const out: Record<string, unknown> = {};
  for (const [name, fn] of [
    ["expired", () => expireUnpaidOrders()],
    ["settled", () => releaseSettlements()],
    ["webhooks", () => retryDueWebhooks()],
    ["reconciliation", () => runReconciliation()],
    ["monitoring", () => runMonitoring()],
    ["moderation-retention", () => purgeModerationRetention()],
    ["shipment-tracking-poll", () => pollActiveShipments()],
  ] as const) {
    try { out[name] = await fn(); } catch (e) { out[name] = { error: (e as Error).message }; }
  }
  return NextResponse.json(out);
}
export const POST = handler;
export const GET = handler;
