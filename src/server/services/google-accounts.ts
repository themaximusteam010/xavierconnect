/**
 * Account-linking policy for Google sign-in. Prevents duplicate accounts and account takeover:
 *
 *  1. Known Google identity (provider+sub) → that user. Never matched by email alone.
 *  2. Signed-in user linking from settings → link to that user (sub must not belong to someone else).
 *  3. New identity whose verified email matches an existing account:
 *       - auto-link only if the existing account's email is verified AND Google is authoritative for
 *         the address (gmail.com / googlemail.com) AND the account is not a staff account;
 *       - otherwise refuse and ask the person to sign in with their password and link from settings.
 *         (Stops "pre-registration" takeovers of unverified accounts and links on domains Google
 *         doesn't own.)
 *  4. Otherwise create a new CUSTOMER account. Google never grants vendor or staff access.
 * Every outcome is recorded in OAuthAccountLink.
 */
import { db } from "@/server/db";
import { ROLES } from "@/server/auth/rbac";
import type { GoogleClaims } from "@/server/auth/google";
import { audit } from "./audit";

export class LinkRefused extends Error {}
const AUTHORITATIVE = /@(gmail\.com|googlemail\.com)$/i;

export async function resolveGoogleLogin(c: GoogleClaims, opts: { linkUserId?: string; ip?: string } = {}): Promise<{ userId: string; created: boolean; linked: boolean }> {
  const record = (userId: string | null, action: string, reason?: string) => db.oAuthAccountLink.create({ data: { userId, provider: "google", subject: c.sub, action, reason, ip: opts.ip } });
  const existingIdentity = await db.externalIdentityAccount.findUnique({ where: { provider_subject: { provider: "google", subject: c.sub } } });

  if (existingIdentity) {
    if (opts.linkUserId && existingIdentity.userId !== opts.linkUserId) {
      await record(opts.linkUserId, "REFUSED", "identity linked to another account");
      throw new LinkRefused("This Google account is already connected to a different XavierConnect account.");
    }
    await db.externalIdentityAccount.update({ where: { id: existingIdentity.id }, data: { lastLoginAt: new Date(), email: c.email, emailVerified: !!c.email_verified, name: c.name } });
    return { userId: existingIdentity.userId, created: false, linked: false };
  }

  if (opts.linkUserId) {
    await db.externalIdentityAccount.create({ data: { userId: opts.linkUserId, provider: "google", subject: c.sub, email: c.email, emailVerified: !!c.email_verified, name: c.name, lastLoginAt: new Date() } });
    await record(opts.linkUserId, "LINKED", "linked from account settings");
    await audit(db, { actorId: opts.linkUserId, action: "auth.google.link", entityType: "User", entityId: opts.linkUserId });
    return { userId: opts.linkUserId, created: false, linked: true };
  }

  if (!c.email || !c.email_verified) {
    await record(null, "REFUSED", "email not verified by Google");
    throw new LinkRefused("Your Google account doesn't have a verified email address, so we can't use it to sign in.");
  }

  const existing = await db.user.findUnique({ where: { email: c.email }, include: { roles: { include: { role: true } } } });
  if (existing) {
    const staff = existing.roles.some((r) => ROLES[r.role.key]?.staff);
    const canAutoLink = !!existing.emailVerifiedAt && AUTHORITATIVE.test(c.email) && !staff && existing.status === "ACTIVE" && !existing.deletedAt;
    if (!canAutoLink) {
      await record(existing.id, "REFUSED", staff ? "staff account" : !existing.emailVerifiedAt ? "existing account email unverified" : "email domain not Google-managed");
      throw new LinkRefused("An account with this email already exists. Sign in with your password, then connect Google from Account → Settings. Forgot your password? Reset it by email.");
    }
    await db.externalIdentityAccount.create({ data: { userId: existing.id, provider: "google", subject: c.sub, email: c.email, emailVerified: true, name: c.name, lastLoginAt: new Date() } });
    await record(existing.id, "LINKED", "verified Gmail address matched a verified account");
    await audit(db, { actorId: existing.id, action: "auth.google.link", entityType: "User", entityId: existing.id, after: { automatic: true } });
    return { userId: existing.id, created: false, linked: true };
  }

  const customer = await db.role.findUniqueOrThrow({ where: { key: "CUSTOMER" } });
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email: c.email!, name: (c.name ?? c.email!.split("@")[0]).slice(0, 80), passwordHash: null, emailVerifiedAt: new Date(), roles: { create: { roleId: customer.id } } } });
    await tx.externalIdentityAccount.create({ data: { userId: u.id, provider: "google", subject: c.sub, email: c.email, emailVerified: true, name: c.name, lastLoginAt: new Date() } });
    return u;
  });
  await record(user.id, "SIGNED_UP");
  await audit(db, { actorId: user.id, action: "auth.google.signup", entityType: "User", entityId: user.id });
  return { userId: user.id, created: true, linked: true };
}

export async function unlinkGoogle(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { externalIdentities: true } });
  const g = u.externalIdentities.filter((i) => i.provider === "google");
  if (!g.length) return;
  if (!u.passwordHash && u.externalIdentities.length <= g.length) throw new LinkRefused("Set a password first (use “Forgot password”), otherwise you would lose access to your account.");
  await db.externalIdentityAccount.deleteMany({ where: { userId, provider: "google" } });
  for (const i of g) await db.oAuthAccountLink.create({ data: { userId, provider: "google", subject: i.subject, action: "UNLINKED" } });
  await audit(db, { actorId: userId, action: "auth.google.unlink", entityType: "User", entityId: userId });
}
