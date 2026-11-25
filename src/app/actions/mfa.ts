"use server";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { newTotpSecret, verifyTotp } from "@/server/auth/totp";
import { decryptJson, encryptJson } from "@/server/crypto";
import { sha256 } from "@/server/auth/tokens";
import { rateLimit } from "@/server/rate-limit";
import { audit } from "@/server/services/audit";
import type { ActionState } from "@/lib/validation";

async function pendingSecret(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.mfaEnabledAt) return null;
  if (u.mfaSecret) return decryptJson<string>(u.mfaSecret);
  const secret = newTotpSecret();
  await db.user.update({ where: { id: userId }, data: { mfaSecret: encryptJson(secret) } });
  return secret;
}

export async function getEnrollmentSecret() {
  const u = await requireUser("/mfa");
  return pendingSecret(u.id);
}

export async function confirmEnrollmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser("/mfa");
  if (!(await rateLimit("mfa", 10, 600, u.id))) return { ok: false, message: "Too many attempts. Wait 10 minutes." };
  const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
  if (row.mfaEnabledAt || !row.mfaSecret) return { ok: false, message: "Enrolment is not in progress." };
  if (!verifyTotp(decryptJson<string>(row.mfaSecret), String(fd.get("code") ?? ""))) return { ok: false, message: "That code didn't match. Check the time on your phone and try again." };
  const codes = Array.from({ length: 8 }, () => randomBytes(5).toString("hex"));
  await db.$transaction([
    db.user.update({ where: { id: u.id }, data: { mfaEnabledAt: new Date(), mfaRecoveryCodes: codes.map(sha256) } }),
    db.session.update({ where: { id: u.sessionId }, data: { mfaVerifiedAt: new Date() } }),
  ]);
  await audit(db, { actorId: u.id, action: "mfa.enrol", entityType: "User", entityId: u.id });
  return { ok: true, message: codes.join(" ") };
}

export async function verifyMfaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser("/mfa");
  if (!(await rateLimit("mfa", 10, 600, u.id))) return { ok: false, message: "Too many attempts. Wait 10 minutes." };
  const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
  if (!row.mfaEnabledAt || !row.mfaSecret) return { ok: false, message: "Set up two-step verification first." };
  const code = String(fd.get("code") ?? "").trim().toLowerCase();
  let ok = verifyTotp(decryptJson<string>(row.mfaSecret), code);
  if (!ok && /^[0-9a-f]{10}$/.test(code) && row.mfaRecoveryCodes.includes(sha256(code))) {
    ok = true;
    await db.user.update({ where: { id: u.id }, data: { mfaRecoveryCodes: row.mfaRecoveryCodes.filter((c) => c !== sha256(code)) } });
    await audit(db, { actorId: u.id, action: "mfa.recovery_code_used", entityType: "User", entityId: u.id });
  }
  if (!ok) {
    await audit(db, { actorId: u.id, action: "mfa.failed", entityType: "User", entityId: u.id });
    return { ok: false, message: "That code didn't match." };
  }
  await db.session.update({ where: { id: u.sessionId }, data: { mfaVerifiedAt: new Date() } });
  redirect("/admin");
}
