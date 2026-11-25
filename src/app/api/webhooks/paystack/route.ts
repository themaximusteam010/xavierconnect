import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { paystackProvider } from "@/server/payments/paystack";
import { confirmPayment } from "@/server/services/orders";

/**
 * Paystack webhook. Signature is verified over the raw body before anything is parsed or stored.
 * Each event is recorded once (unique provider+eventKey); replays are acknowledged and ignored.
 * The payment itself is always re-verified with Paystack's API inside confirmPayment().
 */
export async function POST(req: Request) {
  if (!process.env.PAYSTACK_SECRET_KEY) return new NextResponse("Not configured", { status: 503 });
  const raw = await req.text();
  const evt = paystackProvider.parseWebhook(raw, req.headers);
  if (!evt) return new NextResponse("Invalid signature", { status: 401 });

  const existing = await db.paymentEvent.findUnique({ where: { provider_eventKey: { provider: "paystack", eventKey: evt.eventKey } } });
  if (existing?.processedAt) return NextResponse.json({ ok: true, duplicate: true });
  const row = existing ?? (await db.paymentEvent.create({ data: { provider: "paystack", eventKey: evt.eventKey, type: evt.type, payload: evt.payload as object, signatureOk: true } }));

  try {
    if (evt.type === "charge.success" && evt.reference) await confirmPayment(evt.reference);
    await db.paymentEvent.update({ where: { id: row.id }, data: { processedAt: new Date(), error: null } });
  } catch (e) {
    await db.paymentEvent.update({ where: { id: row.id }, data: { error: (e as Error).message.slice(0, 500) } });
    return new NextResponse("Retry", { status: 500 }); // Paystack retries non-2xx
  }
  return NextResponse.json({ ok: true });
}
