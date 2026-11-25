"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, destroySession, getCurrentUser } from "@/server/auth/session";
import { randomToken, sha256 } from "@/server/auth/tokens";
import { rateLimit } from "@/server/rate-limit";
import { sendEmail, appUrl } from "@/server/services/notify";
import { mergeGuestCart } from "@/server/services/cart";
import { CART_COOKIE } from "@/server/cart-ident";
import { email as emailSchema, fieldErrors, formValues, password as passwordSchema, registerSchema, type ActionState } from "@/lib/validation";

function safeNext(n: FormDataEntryValue | null) {
  const s = typeof n === "string" ? n : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/account";
}

async function issueToken(userId: string, type: "EMAIL_VERIFY" | "PASSWORD_RESET", hours: number) {
  const token = randomToken();
  await db.verificationToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  await db.verificationToken.create({ data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3600_000) } });
  return token;
}

async function sendVerification(userId: string, to: string) {
  const token = await issueToken(userId, "EMAIL_VERIFY", 48);
  await sendEmail(db, {
    to,
    subject: "Confirm your email for XavierConnect",
    text: `Confirm your email address to finish setting up your account:\n\n${appUrl(`/verify-email?token=${token}`)}\n\nThis link expires in 48 hours. If you did not create an account, ignore this email.`,
  });
}

async function afterLogin(userId: string) {
  const guest = (await cookies()).get(CART_COOKIE)?.value;
  if (guest) {
    await mergeGuestCart(db, guest, userId);
    (await cookies()).delete(CART_COOKIE);
  }
}

export async function registerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd, ["name", "email"]);
  if (!(await rateLimit("register", 5, 600))) return { ok: false, message: "Too many attempts. Please wait a few minutes.", values };
  const parsed = registerSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), values };
  const { name, email, password } = parsed.data;
  const exists = await db.user.findUnique({ where: { email } });
  if (exists) return { ok: false, errors: { email: ["An account with this email already exists. Sign in instead."] }, values };

  const customer = await db.role.findUniqueOrThrow({ where: { key: "CUSTOMER" } });
  const user = await db.user.create({
    data: { name, email, passwordHash: await hashPassword(password), roles: { create: { roleId: customer.id } } },
  });
  await sendVerification(user.id, email);
  await createSession(user.id);
  await afterLogin(user.id);
  redirect(`/verify-email?sent=1&next=${encodeURIComponent(safeNext(fd.get("next")))}`);
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd, ["email"]);
  const parsed = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password") }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), values };
  const { email, password } = parsed.data;
  if (!(await rateLimit("login", 10, 600)) || !(await rateLimit("login-acct", 8, 900, email))) {
    return { ok: false, message: "Too many sign-in attempts. Please wait 15 minutes or reset your password.", values };
  }
  const user = await db.user.findUnique({ where: { email } });
  // Same response for unknown email and wrong password; verify a dummy hash to equalise timing.
  const ok = user ? await verifyPassword(user.passwordHash, password) : (await hashPassword(password), false);
  if (!user || !ok) return { ok: false, message: "That email and password combination is not correct.", values };
  if (user.status !== "ACTIVE") return { ok: false, message: "This account is suspended. Contact support for help.", values };
  await createSession(user.id);
  await afterLogin(user.id);
  redirect(safeNext(fd.get("next")));
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

export async function resendVerificationAction(): Promise<ActionState> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (u.emailVerified) return { ok: true, message: "Your email is already verified." };
  if (!(await rateLimit("verify-resend", 3, 900, u.id))) return { ok: false, message: "Please wait before requesting another email." };
  await sendVerification(u.id, u.email);
  return { ok: true, message: `We sent a new link to ${u.email}.` };
}

export async function verifyEmailToken(token: string) {
  const row = await db.verificationToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.type !== "EMAIL_VERIFY" || row.usedAt || row.expiresAt < new Date()) return false;
  await db.$transaction([
    db.verificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
  return true;
}

export async function forgotPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = emailSchema.safeParse(fd.get("email"));
  if (!parsed.success) return { ok: false, errors: { email: ["Enter a valid email address"] } };
  if (!(await rateLimit("forgot", 5, 900))) return { ok: false, message: "Too many requests. Try again later." };
  const user = await db.user.findUnique({ where: { email: parsed.data } });
  if (user && user.status === "ACTIVE") {
    const token = await issueToken(user.id, "PASSWORD_RESET", 1);
    await sendEmail(db, {
      to: user.email,
      subject: "Reset your XavierConnect password",
      text: `Use this link to choose a new password. It expires in 1 hour.\n\n${appUrl(`/reset-password?token=${token}`)}\n\nIf you did not ask for this, you can ignore this email.`,
    });
  }
  // Same message either way so the form cannot be used to discover accounts.
  return { ok: true, message: "If an account exists for that email, a reset link is on its way." };
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z.object({ token: z.string().min(10), password: passwordSchema }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const row = await db.verificationToken.findUnique({ where: { tokenHash: sha256(parsed.data.token) } });
  if (!row || row.type !== "PASSWORD_RESET" || row.usedAt || row.expiresAt < new Date()) {
    return { ok: false, message: "This reset link is invalid or has expired. Request a new one." };
  }
  await db.$transaction([
    db.verificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(parsed.data.password) } }),
    db.session.deleteMany({ where: { userId: row.userId } }), // sign out everywhere
  ]);
  redirect("/login?reset=1");
}
