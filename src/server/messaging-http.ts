/** Shared guards for messaging route handlers: session, same-origin, JSON errors. */
import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/server/auth/session";
import { MessagingError } from "@/server/services/messaging";

export async function messagingUser(req: Request): Promise<CurrentUser | NextResponse> {
  // Same-origin check for state-changing requests (cookies are SameSite=Lax as a second layer).
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!origin || !host || new URL(origin).host !== host) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  }
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Sign in to use messages." }, { status: 401 });
  return u;
}

export function messagingError(e: unknown) {
  if (e instanceof MessagingError) {
    const status = e.code === "NOT_FOUND" ? 404 : e.code === "FORBIDDEN" ? 403 : e.code === "RATE_LIMITED" ? 429 : e.code === "INVALID" ? 400 : 409;
    return NextResponse.json({ error: e.message, code: e.code }, { status });
  }
  throw e;
}
