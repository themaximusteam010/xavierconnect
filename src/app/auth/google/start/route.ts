import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { beginGoogleLogin, googleEnabled, OAUTH_COOKIE } from "@/server/auth/google";

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/account");

/** GET /auth/google/start?next=/path  ·  ?link=1 (signed-in user connecting Google from settings) */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!googleEnabled()) return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("Google sign-in isn't available yet."), url));
  const link = url.searchParams.get("link") === "1";
  const user = link ? await getCurrentUser() : null;
  if (link && !user) return NextResponse.redirect(new URL("/login?next=/account/settings", url));
  const { url: to, cookie } = await beginGoogleLogin({ next: link ? "/account/settings" : safeNext(url.searchParams.get("next")), linkUserId: user?.id });
  const res = NextResponse.redirect(to);
  res.cookies.set(OAUTH_COOKIE, cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/auth/google", maxAge: 600 });
  return res;
}
