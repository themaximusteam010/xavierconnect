import { NextResponse } from "next/server";
import { ingestWebhook } from "@/server/services/webhooks";

/** Single entry point for provider webhooks: /api/webhooks/paystack, /api/webhooks/shipbubble, … */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!/^[a-z0-9-]{2,40}$/.test(provider)) return new NextResponse("Not found", { status: 404 });
  const raw = await req.text();
  if (raw.length > 512_000) return new NextResponse("Payload too large", { status: 413 });
  const res = await ingestWebhook(provider, raw, req.headers);
  return new NextResponse(res.body, { status: res.status });
}
