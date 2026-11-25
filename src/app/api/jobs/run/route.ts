import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { expireUnpaidOrders } from "@/server/services/orders";
import { releaseSettlements } from "@/server/services/finance";

/**
 * Scheduled maintenance. Call every 5 minutes from a cron (Vercel Cron, systemd timer, etc.)
 * with header `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const expired = await expireUnpaidOrders();
  const settled = await releaseSettlements();
  return NextResponse.json({ expired, settled });
}
