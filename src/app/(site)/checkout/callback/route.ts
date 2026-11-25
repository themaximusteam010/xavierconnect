import { NextResponse, type NextRequest } from "next/server";
import { paymentReturnPath } from "@/server/services/payment-return";

/** Payment provider redirects here. We always verify server-to-server; the query string is not trusted. */
export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get("reference") ?? req.nextUrl.searchParams.get("trxref");
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  const target = reference ? await paymentReturnPath(reference) : "/cart";
  return NextResponse.redirect(new URL(target, base), 303);
}
