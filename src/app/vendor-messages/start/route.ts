import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { startAsVendor, MessagingError, messagingVendorIds } from "@/server/services/messaging";

/** "Message buyer" from a vendor order or booking. Vendors can only contact their own customers. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const u = await getCurrentUser();
  if (!u) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, url));
  const vendorId = messagingVendorIds(u)[0];
  if (!vendorId) return NextResponse.redirect(new URL("/vendor", url));
  try {
    const { conversation, ref } = await startAsVendor(u, vendorId, { vendorOrderId: url.searchParams.get("order") ?? undefined, bookingId: url.searchParams.get("booking") ?? undefined });
    return NextResponse.redirect(new URL(`/vendor/messages/${conversation.id}${ref.orderId ? `?order=${ref.orderId}` : ""}`, url));
  } catch (e) {
    if (e instanceof MessagingError) return NextResponse.redirect(new URL(`/vendor/messages?error=${encodeURIComponent(e.message)}`, url));
    throw e;
  }
}
