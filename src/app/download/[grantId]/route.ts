import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { MIME, readStored } from "@/server/storage";

/**
 * Protected digital download. Checks ownership, expiry, revocation and the download limit
 * atomically (conditional increment), then streams the private file.
 */
export async function GET(_: Request, { params }: { params: Promise<{ grantId: string }> }) {
  const { grantId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=/account/downloads`, process.env.APP_URL ?? "http://localhost:3000"));
  const grant = await db.downloadGrant.findFirst({ where: { id: grantId, userId: user.id }, include: { asset: true } });
  if (!grant) return new NextResponse("Not found", { status: 404 });
  const claimed = await db.$executeRaw`
    UPDATE "DownloadGrant" SET "downloadsUsed" = "downloadsUsed" + 1
     WHERE id = ${grantId} AND "userId" = ${user.id} AND "revokedAt" IS NULL AND "expiresAt" > now() AND "downloadsUsed" < "maxDownloads"`;
  if (claimed === 0) return new NextResponse("This download link has expired or reached its limit. Contact support to restore access.", { status: 410 });
  try {
    const buf = await readStored(grant.asset.fileKey);
    const ext = grant.asset.fileKey.split(".").pop() ?? "";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${grant.asset.fileName.replace(/[^\w.\-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    await db.downloadGrant.update({ where: { id: grantId }, data: { downloadsUsed: { decrement: 1 } } });
    return new NextResponse("File temporarily unavailable. Please contact support.", { status: 503 });
  }
}
