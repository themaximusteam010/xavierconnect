"use server";
import { z } from "zod";
import { db } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { getCurrentUser } from "@/server/auth/session";
import { email, type ActionState } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function subscribeNewsletter(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = email.safeParse(fd.get("email"));
  if (!parsed.success) return { ok: false, message: "Enter a valid email address." };
  if (!(await rateLimit("newsletter", 5, 3600))) return { ok: false, message: "Please try again later." };
  await db.newsletterSubscriber.upsert({ where: { email: parsed.data }, update: {}, create: { email: parsed.data } });
  return { ok: true, message: "You're subscribed. Thanks!" };
}

export async function toggleWishlist(fd: FormData) {
  const u = await getCurrentUser();
  const productId = String(fd.get("productId"));
  const back = String(fd.get("back") || "/");
  if (!u) redirect(`/login?next=${encodeURIComponent(back)}`);
  const key = { userId_productId: { userId: u.id, productId } };
  const existing = await db.wishlistItem.findUnique({ where: key });
  if (existing) await db.wishlistItem.delete({ where: key });
  else if (await db.product.findFirst({ where: { id: productId, status: "PUBLISHED" } })) await db.wishlistItem.create({ data: { userId: u.id, productId } });
  revalidatePath(back);
}

export async function toggleFollowStore(fd: FormData) {
  const u = await getCurrentUser();
  const storeId = String(fd.get("storeId"));
  const back = String(fd.get("back") || "/");
  if (!u) redirect(`/login?next=${encodeURIComponent(back)}`);
  const key = { userId_storeId: { userId: u.id, storeId } };
  if (await db.storeFollow.findUnique({ where: key })) await db.storeFollow.delete({ where: key });
  else await db.storeFollow.create({ data: { userId: u.id, storeId } });
  revalidatePath(back);
}

const reportSchema = z.object({
  targetType: z.enum(["PRODUCT", "VENDOR", "REVIEW"]),
  targetId: z.string().min(1),
  reason: z.enum(["Counterfeit or fake", "Prohibited item", "Misleading information", "Offensive content", "Fraud or scam", "Other"]),
  details: z.string().max(1000).optional(),
  back: z.string(),
});

export async function reportAction(fd: FormData) {
  const u = await getCurrentUser();
  const parsed = reportSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return;
  if (!u) redirect(`/login?next=${encodeURIComponent(parsed.data.back)}`);
  if (!(await rateLimit("report", 10, 3600, u.id))) return;
  await db.report.create({ data: { reporterId: u.id, targetType: parsed.data.targetType, targetId: parsed.data.targetId, reason: parsed.data.reason, details: parsed.data.details } });
  redirect(`${parsed.data.back}${parsed.data.back.includes("?") ? "&" : "?"}reported=1`);
}

export async function contactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z.object({ name: z.string().trim().min(2).max(100), email, message: z.string().trim().min(10, "Tell us a little more").max(4000) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  if (!(await rateLimit("contact", 3, 3600))) return { ok: false, message: "Please try again later." };
  const { sendEmail } = await import("@/server/services/notify");
  await sendEmail(db, { to: process.env.SUPPORT_EMAIL ?? "support@xavierconnect.com", subject: `Contact form: ${parsed.data.name}`, text: `${parsed.data.message}\n\nReply to: ${parsed.data.email}` });
  return { ok: true, message: "Thanks — our team will reply by email within one business day." };
}
