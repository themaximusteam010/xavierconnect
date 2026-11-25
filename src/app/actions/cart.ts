"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { ensureCartIdent, readCartIdent } from "@/server/cart-ident";
import { addToCart, CartError, getOrCreateCart, resolveCoupon, setCartQuantity } from "@/server/services/cart";
import { rateLimit } from "@/server/rate-limit";
import type { ActionState } from "@/lib/validation";

export async function addToCartAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z.object({ productId: z.string().min(1), variantId: z.string().optional().default(""), quantity: z.coerce.number().int().min(1).max(99), buyNow: z.string().optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, message: "Please choose a valid quantity." };
  if (!(await rateLimit("cart", 60, 60))) return { ok: false, message: "Slow down a little and try again." };
  try {
    await addToCart(db, await ensureCartIdent(), parsed.data.productId, parsed.data.quantity, parsed.data.variantId);
  } catch (e) {
    if (e instanceof CartError) return { ok: false, message: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  if (parsed.data.buyNow) redirect("/checkout");
  return { ok: true, message: "Added to your cart." };
}

export async function updateCartItemAction(fd: FormData) {
  const itemId = String(fd.get("itemId"));
  const quantity = Number(fd.get("quantity"));
  try {
    await setCartQuantity(db, await readCartIdent(), itemId, Number.isFinite(quantity) ? quantity : 0);
  } catch (e) {
    if (e instanceof CartError) redirect(`/cart?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/", "layout");
}

export async function applyCouponAction(fd: FormData) {
  const code = String(fd.get("code") ?? "").trim().toUpperCase().slice(0, 40);
  const ident = await ensureCartIdent();
  const cart = await getOrCreateCart(db, ident);
  if (!code) {
    await db.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
  } else {
    if (!(await rateLimit("coupon", 15, 600))) redirect(`/cart?error=${encodeURIComponent("Too many attempts.")}`);
    if (!(await resolveCoupon(db, code))) redirect(`/cart?error=${encodeURIComponent("That code is not valid or has expired.")}`);
    await db.cart.update({ where: { id: cart.id }, data: { couponCode: code } });
  }
  revalidatePath("/cart");
}
