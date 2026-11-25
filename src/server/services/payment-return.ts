import { db } from "@/server/db";
import { sign } from "@/server/auth/tokens";
import { confirmPayment } from "./orders";

/** Verify a returning payment and work out where to send the customer. Used by the provider callback and the sandbox page. */
export async function paymentReturnPath(reference: string): Promise<string> {
  const payment = await db.payment.findUnique({ where: { reference }, include: { order: true } });
  if (!payment) return "/cart";
  let outcome: string;
  try {
    outcome = (await confirmPayment(reference)).outcome;
  } catch (e) {
    console.error("[payment] confirm failed", reference, e);
    outcome = "pending";
  }
  const number = payment.order.number;
  return payment.order.userId
    ? `/account/orders/${number}?payment=${outcome}`
    : `/checkout/complete/${number}?payment=${outcome}&t=${encodeURIComponent(sign(`receipt:${number}`, Date.now() + 7 * 864e5))}`;
}
