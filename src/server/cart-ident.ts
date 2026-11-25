import "server-only";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/server/auth/session";
import { randomToken } from "@/server/auth/tokens";
import type { CartIdent } from "@/server/services/cart";

export const CART_COOKIE = "xc_cart";

/** Read-only: for rendering. */
export async function readCartIdent(): Promise<CartIdent> {
  const u = await getCurrentUser();
  if (u) return { userId: u.id };
  return { guestToken: (await cookies()).get(CART_COOKIE)?.value ?? null };
}

/** For server actions: creates a guest token cookie when needed. */
export async function ensureCartIdent(): Promise<CartIdent> {
  const u = await getCurrentUser();
  if (u) return { userId: u.id };
  const jar = await cookies();
  let token = jar.get(CART_COOKIE)?.value;
  if (!token) {
    token = randomToken(24);
    jar.set(CART_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  return { guestToken: token };
}
