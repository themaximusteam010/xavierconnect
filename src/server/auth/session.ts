import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/server/db";
import { randomToken, sha256 } from "./tokens";
import { hasVendorCapability, permissionsFor, type Permission, type RoleGrant, type VendorCapability } from "./rbac";

export const SESSION_COOKIE = "xc_session";
const SESSION_DAYS = 30;

export async function createSession(userId: string) {
  const token = randomToken();
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  grants: RoleGrant[];
  permissions: Set<Permission>;
  vendorIds: string[];
  isStaff: boolean;
  sessionId: string;
  mfaEnabled: boolean;
  mfaVerified: boolean;
}

export const STAFF_ROLES = ["SUPER_ADMIN", "MARKETPLACE_ADMIN", "MARKETPLACE_MANAGER", "FINANCE_MANAGER", "VENDOR_MANAGER", "SUPPORT_AGENT", "CONTENT_MANAGER"];
export const mfaRequired = () => process.env.ADMIN_MFA_REQUIRED !== "false";

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { roles: { include: { role: true } } } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  const u = session.user;
  if (u.status !== "ACTIVE" || u.deletedAt) return null;
  const grants: RoleGrant[] = u.roles.map((r) => ({ role: r.role.key, vendorId: r.vendorId }));
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    emailVerified: !!u.emailVerifiedAt,
    grants,
    permissions: permissionsFor(grants),
    vendorIds: [...new Set(grants.filter((g) => g.vendorId).map((g) => g.vendorId!))],
    isStaff: grants.some((g) => STAFF_ROLES.includes(g.role)),
    sessionId: session.id,
    mfaEnabled: !!u.mfaEnabledAt,
    mfaVerified: !!session.mfaVerifiedAt,
  };
});

export class AuthError extends Error {
  constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN", message?: string) {
    super(message ?? code);
  }
}

export async function requireUser(nextPath?: string): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect(`/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`);
  return u;
}

/** Server-side check used by every admin action. Staff must have completed MFA in this session. */
export async function requirePermission(p: Permission): Promise<CurrentUser> {
  const u = await requireUser("/admin");
  if (!u.permissions.has(p)) throw new AuthError("FORBIDDEN", `Missing permission ${p}`);
  if (u.isStaff && mfaRequired() && !(u.mfaEnabled && u.mfaVerified)) redirect("/mfa");
  return u;
}

export function can(u: CurrentUser | null, p: Permission) {
  return !!u?.permissions.has(p);
}

/**
 * Resolve the vendor workspace the user is acting in and assert a capability.
 * Every vendor query MUST filter by the returned vendorId — this is the tenant boundary.
 */
export async function requireVendor(cap: VendorCapability) {
  const u = await requireUser("/vendor");
  const vendorId = u.vendorIds[0];
  if (!vendorId) redirect("/sell");
  if (!hasVendorCapability(u.grants, vendorId, cap)) throw new AuthError("FORBIDDEN", `Missing vendor capability ${cap}`);
  const vendor = await db.vendor.findUniqueOrThrow({ where: { id: vendorId }, include: { store: true } });
  return { user: u, vendor, vendorId };
}
