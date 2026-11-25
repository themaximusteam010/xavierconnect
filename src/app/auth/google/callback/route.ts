import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { db } from "@/server/db";
import { createSession, getCurrentUser } from "@/server/auth/session";
import { finishGoogleLogin, readState, GoogleAuthError, OAUTH_COOKIE } from "@/server/auth/google";
import { resolveGoogleLogin, LinkRefused } from "@/server/services/google-accounts";
import { mergeGuestCart } from "@/server/services/cart";
import { CART_COOKIE } from "@/server/cart-ident";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get(OAUTH_COOKIE)?.value;
  jar.delete({ name: OAUTH_COOKIE, path: "/auth/google" }); // single use
  const fail = (msg: string, link?: boolean) => NextResponse.redirect(new URL(`${link ? "/account/settings" : "/login"}?error=${encodeURIComponent(msg)}`, url));
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error") === "access_denied" ? "Google sign-in was cancelled." : "Google sign-in failed. Please try again.");
  let st;
  try { st = readState(raw, url.searchParams.get("state")); } catch (e) { if (e instanceof GoogleAuthError) return fail(e.message); throw e; }
  const code = url.searchParams.get("code");
  if (!code) return fail("Google sign-in failed. Please try again.", !!st.linkUserId);
  try {
    // A linking request must still come from the same signed-in user.
    if (st.linkUserId && (await getCurrentUser())?.id !== st.linkUserId) return fail("Sign in again to connect Google.");
    const claims = await finishGoogleLogin(code, st);
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
    const r = await resolveGoogleLogin(claims, { linkUserId: st.linkUserId, ip });
    const user = await db.user.findUniqueOrThrow({ where: { id: r.userId } });
    if (user.status !== "ACTIVE" || user.deletedAt) return fail("This account is suspended. Contact support for help.");
    if (st.linkUserId) return NextResponse.redirect(new URL("/account/settings?ok=" + encodeURIComponent("Google account connected."), url));
    await createSession(user.id);
    const guest = jar.get(CART_COOKIE)?.value;
    if (guest) { await mergeGuestCart(db, guest, user.id); jar.delete(CART_COOKIE); }
    return NextResponse.redirect(new URL(r.created ? `/account?welcome=1` : st.next, url));
  } catch (e) {
    if (e instanceof GoogleAuthError || e instanceof LinkRefused) return fail(e.message, !!st.linkUserId);
    throw e;
  }
}
