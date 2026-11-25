import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { MIME, readStored } from "@/server/storage";
import { audit } from "@/server/services/audit";

/** Private KYC document viewer for staff with vendor.view. Every access is audit-logged. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getCurrentUser();
  if (!u?.permissions.has("vendor.view")) return new NextResponse("Forbidden", { status: 403 });
  const doc = await db.vendorDocument.findUnique({ where: { id } });
  if (!doc) return new NextResponse("Not found", { status: 404 });
  await audit(db, { actorId: u.id, action: "kyc.document.view", entityType: "VendorDocument", entityId: id });
  try {
    const buf = await readStored(doc.fileKey);
    const ext = doc.fileKey.split(".").pop() ?? "";
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="${doc.fileName.replace(/[^\w.\-]/g, "_")}"` } });
  } catch {
    return new NextResponse("File missing from storage", { status: 404 });
  }
}
