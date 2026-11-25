import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/server/db";
import { runSeed } from "../../../../prisma/seed-lib";

/**
 * One-time production bootstrap: creates roles, categories, CMS content and the first super admin.
 * Enabled only while BOOTSTRAP_SECRET is set; remove that variable after first use.
 *   POST /api/bootstrap  Authorization: Bearer $BOOTSTRAP_SECRET   (?demo=1 adds the labelled demo catalogue)
 */
export async function POST(req: Request) {
  const secret = process.env.BOOTSTRAP_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || secret.length < 24 || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return new NextResponse("Not found", { status: 404 });
  }
  const demo = new URL(req.url).searchParams.get("demo") === "1";
  await runSeed(db, {
    adminEmail: process.env.SEED_ADMIN_EMAIL,
    adminPassword: process.env.SEED_ADMIN_PASSWORD,
    demo,
    demoPassword: process.env.SEED_DEMO_PASSWORD,
    writeLocalFiles: false,
  });
  const counts = { users: await db.user.count(), categories: await db.category.count(), products: await db.product.count() };
  return NextResponse.json({ ok: true, demo, counts });
}
