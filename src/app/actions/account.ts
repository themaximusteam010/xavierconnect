"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { unlinkGoogle, LinkRefused } from "@/server/services/google-accounts";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { addressSchema, fieldErrors, password, type ActionState } from "@/lib/validation";
import { rateLimit } from "@/server/rate-limit";

export async function saveAddressAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const values = Object.fromEntries(fd) as Record<string, string>;
  const parsed = addressSchema.safeParse(values);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), values };
  const count = await db.address.count({ where: { userId: u.id } });
  if (count >= 20) return { ok: false, message: "You can save up to 20 addresses." };
  await db.address.create({ data: { ...parsed.data, label: values.label || null, userId: u.id, isDefault: count === 0 } });
  revalidatePath("/account/addresses");
  return { ok: true, message: "Address saved." };
}

export async function deleteAddressAction(fd: FormData) {
  const u = await requireUser();
  await db.address.deleteMany({ where: { id: String(fd.get("id")), userId: u.id } });
  revalidatePath("/account/addresses");
}

export async function setDefaultAddressAction(fd: FormData) {
  const u = await requireUser();
  const id = String(fd.get("id"));
  await db.$transaction([
    db.address.updateMany({ where: { userId: u.id }, data: { isDefault: false } }),
    db.address.updateMany({ where: { id, userId: u.id }, data: { isDefault: true } }),
  ]);
  revalidatePath("/account/addresses");
}

export async function markNotificationsReadAction() {
  const u = await requireUser();
  await db.notification.updateMany({ where: { userId: u.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/account", "layout");
}

export async function updateProfileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const parsed = z.object({ name: z.string().trim().min(2).max(100), phone: z.string().trim().max(20).optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  await db.user.update({ where: { id: u.id }, data: { name: parsed.data.name, phone: parsed.data.phone || null } });
  revalidatePath("/account", "layout");
  return { ok: true, message: "Profile updated." };
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  if (!(await rateLimit("pw-change", 5, 900, u.id))) return { ok: false, message: "Too many attempts." };
  const parsed = z.object({ current: z.string().min(1, "Enter your current password"), next: password }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
  if (!row.passwordHash) return { ok: false, message: "Your account signs in with Google and has no password yet. Use “Forgot password” on the sign-in page to set one by email." };
  if (!(await verifyPassword(row.passwordHash, parsed.data.current))) return { ok: false, errors: { current: ["That is not your current password"] } };
  await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(parsed.data.next) } });
  return { ok: true, message: "Password changed." };
}

export async function signOutEverywhereAction() {
  const u = await requireUser();
  await db.session.deleteMany({ where: { userId: u.id } });
  redirect("/login");
}

const ticketSchema = z.object({
  category: z.enum(["Order problem", "Payment", "Refund", "Delivery", "Digital download", "Booking", "Account", "Selling on XavierConnect", "Other"]),
  subject: z.string().trim().min(5, "Add a short subject").max(140),
  body: z.string().trim().min(20, "Please describe the issue in a little more detail").max(5000),
  orderNumber: z.string().trim().max(30).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
});

export async function createTicketAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const values = Object.fromEntries(fd) as Record<string, string>;
  const parsed = ticketSchema.safeParse(values);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), values };
  if (!(await rateLimit("ticket", 5, 3600, u.id))) return { ok: false, message: "You have opened several tickets recently. Please wait before opening another." };
  const [row] = await db.$queryRaw<{ n: bigint }[]>`SELECT nextval('ticket_number_seq') AS n`;
  const t = await db.supportTicket.create({
    data: {
      number: `T-${row.n}`,
      userId: u.id,
      category: parsed.data.category,
      subject: parsed.data.subject,
      priority: parsed.data.priority,
      orderNumber: parsed.data.orderNumber || null,
      messages: { create: { authorId: u.id, body: parsed.data.body } },
    },
  });
  redirect(`/account/support/${t.number}`);
}

export async function replyTicketAction(fd: FormData) {
  const u = await requireUser();
  const number = String(fd.get("number"));
  const body = String(fd.get("body") ?? "").trim().slice(0, 5000);
  const t = await db.supportTicket.findFirst({ where: { number, userId: u.id } });
  if (!t || body.length < 2) return;
  await db.$transaction([
    db.ticketMessage.create({ data: { ticketId: t.id, authorId: u.id, body } }),
    db.supportTicket.update({ where: { id: t.id }, data: { status: t.status === "RESOLVED" || t.status === "PENDING_CUSTOMER" ? "OPEN" : t.status } }),
  ]);
  revalidatePath(`/account/support/${number}`);
}

export async function unlinkGoogleAction() {
  const u = await requireUser();
  try { await unlinkGoogle(u.id); } catch (e) { if (e instanceof LinkRefused) redirect(`/account/settings?error=${encodeURIComponent(e.message)}`); throw e; }
  redirect(`/account/settings?ok=${encodeURIComponent("Google account disconnected.")}`);
}
