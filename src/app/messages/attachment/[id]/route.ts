import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { authorize } from "@/server/services/messaging";
import { readStored } from "@/server/storage";

/**
 * Private message attachments. The recipient gets the file only once it is APPROVED; the uploader can
 * see their own pending file. Moderators use /admin/communication/attachment/[id] instead (audited).
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getCurrentUser();
  if (!u) return new NextResponse("Not found", { status: 404 });
  const a = await db.messageAttachment.findUnique({ where: { id }, include: { message: { select: { conversationId: true, status: true, senderId: true } } } });
  if (!a || !a.storageKey) return new NextResponse("Not found", { status: 404 });
  try { await authorize(u, a.message.conversationId); } catch { return new NextResponse("Not found", { status: 404 }); }
  const own = a.uploaderId === u.id;
  const visible = own ? a.status !== "BLOCKED" : a.status === "APPROVED" && a.message.status === "DELIVERED";
  if (!visible) return new NextResponse("Not found", { status: 404 });
  const buf = await readStored(a.storageKey);
  const inline = a.mimeType.startsWith("image/");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": a.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${a.fileName.replace(/[^\w.\- ]/g, "_")}"`,
    },
  });
}
