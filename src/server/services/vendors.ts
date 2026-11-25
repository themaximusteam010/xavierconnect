import { db } from "@/server/db";
import { slugify } from "@/lib/slug";
import { audit } from "./audit";
import { notify } from "./notify";
import type { VendorType } from "@prisma/client";

export class VendorError extends Error {}
export const VENDOR_AGREEMENT_VERSION = "2026-11";

async function roleId(key: string) {
  return (await db.role.findUniqueOrThrow({ where: { key } })).id;
}

export async function uniqueStoreSlug(name: string, excludeVendorId?: string) {
  const base = slugify(name) || "store";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const hit = await db.store.findUnique({ where: { slug } });
    if (!hit || hit.vendorId === excludeVendorId) return slug;
  }
  throw new VendorError("Could not allocate a store URL; try another name.");
}

export async function getApplication(userId: string) {
  return db.vendor.findFirst({ where: { ownerId: userId }, include: { store: true, documents: true, shippingMethods: true, payoutAccount: true, beneficiaries: { where: { status: { not: "DISABLED" } }, orderBy: { createdAt: "desc" } } } });
}

export async function startApplication(userId: string, type: VendorType) {
  const existing = await getApplication(userId);
  if (existing) return existing;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.emailVerifiedAt) throw new VendorError("Verify your email address before applying.");
  return db.vendor.create({
    data: { ownerId: userId, type, businessName: user.name, email: user.email, phone: user.phone ?? "", onboardingStep: 2 },
    include: { store: true, documents: true, shippingMethods: true, payoutAccount: true },
  });
}

export function assertEditable(status: string) {
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(status)) throw new VendorError("This application is under review and cannot be edited.");
}

export async function submitApplication(vendorId: string, userId: string) {
  const v = await db.vendor.findFirstOrThrow({ where: { id: vendorId, ownerId: userId }, include: { store: true, documents: true, shippingMethods: true } });
  assertEditable(v.status);
  const missing: string[] = [];
  if (!v.description || !v.businessCategory) missing.push("business details");
  if (!v.addressLine1 || !v.city || !(v.state || v.region)) missing.push("business address");
  if (!v.store) missing.push("storefront");
  if (v.documents.length === 0) missing.push("verification document");
  if (v.type !== "SERVICE_PROVIDER" && v.shippingMethods.length === 0) missing.push("delivery method");
  if (!v.agreementAcceptedAt) missing.push("vendor agreement");
  if (missing.length) throw new VendorError(`Please complete: ${missing.join(", ")}.`);
  await db.vendor.update({ where: { id: v.id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
  await notify(db, { userId, type: "vendor.application", title: "Application received", body: "Thanks for applying to sell on XavierConnect. Our team usually reviews applications within two business days.", link: "/sell/apply" });
}

export async function reviewApplication(
  vendorId: string,
  actorId: string,
  decision: "APPROVE" | "REJECT" | "REQUEST_CHANGES",
  note: string | null,
  level?: "IDENTITY_VERIFIED" | "BUSINESS_VERIFIED",
) {
  return db.$transaction(async (tx) => {
    const v = await tx.vendor.findUniqueOrThrow({ where: { id: vendorId } });
    if (v.status !== "SUBMITTED" && !(decision === "APPROVE" && v.status === "SUSPENDED")) {
      throw new VendorError(`Application is ${v.status}, not awaiting review.`);
    }
    const status = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "CHANGES_REQUESTED";
    const updated = await tx.vendor.update({
      where: { id: vendorId },
      data: {
        status,
        reviewedAt: new Date(),
        reviewNote: note,
        verificationLevel: decision === "APPROVE" ? (level ?? (v.type === "BUSINESS" ? "BUSINESS_VERIFIED" : "IDENTITY_VERIFIED")) : v.verificationLevel,
      },
    });
    if (decision === "APPROVE") {
      const roleKey = v.type === "SERVICE_PROVIDER" ? "SERVICE_PROVIDER" : "VENDOR";
      const rid = (await tx.role.findUniqueOrThrow({ where: { key: roleKey } })).id;
      const has = await tx.userRole.findFirst({ where: { userId: v.ownerId, roleId: rid, vendorId } });
      if (!has) await tx.userRole.create({ data: { userId: v.ownerId, roleId: rid, vendorId } });
      await tx.vendorDocument.updateMany({ where: { vendorId, status: "PENDING" }, data: { status: "ACCEPTED" } });
    }
    await audit(tx, { actorId, action: `vendor.${decision.toLowerCase()}`, entityType: "Vendor", entityId: vendorId, before: { status: v.status }, after: { status, note } });
    const messages = {
      APPROVE: ["Your store is approved", "Welcome to XavierConnect. Your seller dashboard is ready — add your first listing."],
      REJECT: ["Your seller application was not approved", note ?? "Unfortunately we could not approve your application."],
      REQUEST_CHANGES: ["We need a little more information", note ?? "Please update your application."],
    } as const;
    await notify(tx, { userId: v.ownerId, type: "vendor.review", title: messages[decision][0], body: messages[decision][1], link: decision === "APPROVE" ? "/vendor" : "/sell/apply" });
    return updated;
  });
}

export async function setVendorSuspended(vendorId: string, actorId: string, suspended: boolean, reason: string) {
  const v = await db.vendor.findUniqueOrThrow({ where: { id: vendorId } });
  const status = suspended ? "SUSPENDED" : "APPROVED";
  await db.vendor.update({ where: { id: vendorId }, data: { status, reviewNote: reason } });
  await audit(db, { actorId, action: suspended ? "vendor.suspend" : "vendor.reinstate", entityType: "Vendor", entityId: vendorId, before: { status: v.status }, after: { status, reason } });
}

export { roleId };
