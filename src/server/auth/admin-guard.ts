import "server-only";
import { redirect } from "next/navigation";
import { mfaRequired, requireUser } from "./session";
import type { Permission } from "./rbac";

/** For admin pages: sends users without the permission back to the console home with a notice. */
export async function guard(p: Permission) {
  const u = await requireUser("/admin");
  if (!u.permissions.has("admin.access")) redirect("/account");
  if (mfaRequired() && !(u.mfaEnabled && u.mfaVerified)) redirect("/mfa");
  if (!u.permissions.has(p)) redirect("/admin?denied=1");
  return u;
}
