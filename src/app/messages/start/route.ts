import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { startAsCustomer, MessagingError } from "@/server/services/messaging";

/** "Message seller" entry point from product, service, store and order pages. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = req.headers.get("referer") && new URL(req.headers.get("referer")!).host === url.host ? new URL(req.headers.get("referer")!).pathname : "/";
  const u = await getCurrentUser();
  if (!u) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, url));
  try {
    const { conversation, ref } = await startAsCustomer(u, { vendorId: url.searchParams.get("vendor") ?? "", productId: url.searchParams.get("product") ?? undefined, serviceId: url.searchParams.get("service") ?? undefined, orderNumber: url.searchParams.get("order") ?? undefined });
    const q = new URLSearchParams();
    if (ref.productId) q.set("product", ref.productId);
    if (ref.orderId) q.set("order", ref.orderId);
    return NextResponse.redirect(new URL(`/account/messages/${conversation.id}${q.size ? `?${q}` : ""}`, url));
  } catch (e) {
    if (e instanceof MessagingError) return NextResponse.redirect(new URL(`/account/messages?error=${encodeURIComponent(e.message)}&from=${encodeURIComponent(back)}`, url));
    throw e;
  }
}
