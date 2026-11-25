import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser, mfaRequired } from "@/server/auth/session";
import { readStored } from "@/server/storage";
import { audit } from "@/server/services/audit";

/** Moderator preview of a flagged attachment. Only files that are not yet approved; every view is audited. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getCurrentUser();
  if (!u?.permissions.has("messages.moderate") || (mfaRequired() && !u.mfaVerified)) return new NextResponse("Forbidden", { status: 403 });
  const a = await db.messageAttachment.findUnique({ where: { id } });
  if (!a || !a.storageKey || a.status === "APPROVED") return new NextResponse("Not found", { status: 404 });
  await audit(db, { actorId: u.id, action: "moderation.attachment.view", entityType: "MessageAttachment", entityId: a.id });
  const buf = await readStored(a.storageKey);
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": a.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox", "Content-Disposition": `inline; filename="${a.fileName.replace(/[^\w.\- ]/g, "_")}"` } });
}
