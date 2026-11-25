"use server";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { ensureCartIdent } from "@/server/cart-ident";
import { CartError } from "@/server/services/cart";
import { placeOrder, startPayment } from "@/server/services/orders";
import { rateLimit } from "@/server/rate-limit";
import { verifySigned } from "@/server/auth/tokens";
import { paymentReturnPath } from "@/server/services/payment-return";
import { addressSchema, email as emailSchema, fieldErrors, type ActionState } from "@/lib/validation";

export async function placeOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const values = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
  if (!(await rateLimit("checkout", 10, 600))) return { ok: false, message: "Too many attempts. Please wait a few minutes.", values };

  const needsAddress = fd.get("needsAddress") === "1";
  const errors: Record<string, string[]> = {};
  let contactEmail = user?.email ?? "";
  if (!user) {
    const e = emailSchema.safeParse(fd.get("email"));
    if (!e.success) errors.email = ["Enter an email so we can send your receipt"];
    else contactEmail = e.data;
  }
  let address = null;
  if (needsAddress) {
    const a = addressSchema.safeParse(values);
    if (!a.success) Object.assign(errors, fieldErrors(a.error));
    else address = a.data;
  }
  if (Object.keys(errors).length) return { ok: false, errors, values, message: "Please check the highlighted fields." };

  const shippingChoice: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("ship_") && typeof v === "string") shippingChoice[k.slice(5)] = v;

  let url: string;
  try {
    const ident = await ensureCartIdent();
    const { order } = await placeOrder({ ident, email: contactEmail, address, shippingChoice });
    if (user && address && fd.get("saveAddress") === "on") {
      const count = await db.address.count({ where: { userId: user.id } });
      await db.address.create({ data: { ...address, userId: user.id, isDefault: count === 0 } });
    }
    url = await startPayment(order.id, contactEmail);
  } catch (e) {
    if (e instanceof CartError) return { ok: false, message: e.message, values };
    throw e;
  }
  redirect(url);
}

/** Retry payment for an existing unpaid order the user owns. */
export async function payOrderAction(fd: FormData) {
  const user = await getCurrentUser();
  const number = String(fd.get("number"));
  const order = await db.order.findUnique({ where: { number } });
  if (!order || !user || order.userId !== user.id) redirect("/account/orders");
  try {
    redirect(await startPayment(order.id, user.email));
  } catch (e) {
    if (e instanceof CartError) redirect(`/account/orders/${number}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
}

/** Sandbox hosted page decision. Signed token prevents tampering with other references. */
export async function sandboxDecisionAction(fd: FormData) {
  const reference = String(fd.get("reference"));
  const token = String(fd.get("t"));
  const outcome = fd.get("outcome") === "approve" ? "approve" : "decline";
  if (verifySigned(token) !== reference) redirect("/cart?error=" + encodeURIComponent("Payment session expired."));
  const p = await db.payment.findUnique({ where: { reference } });
  if (!p || p.provider !== "sandbox" || p.status !== "INITIATED") redirect("/cart");
  await db.payment.update({ where: { reference }, data: { providerPayload: { sandboxOutcome: outcome } } });
  redirect(await paymentReturnPath(reference));
}
