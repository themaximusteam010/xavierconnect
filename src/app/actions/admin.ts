"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { ROLES } from "@/server/auth/rbac";
import { reviewApplication, setVendorSuspended, VendorError } from "@/server/services/vendors";
import { CatalogError, moderateProduct } from "@/server/services/catalog";
import { failPayout, FinanceError, markPayoutPaid, refundVendorOrder, releaseSettlements } from "@/server/services/finance";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notify";
import { clientIp } from "@/server/rate-limit";

const to = (path: string, k: "ok" | "error", m: string) => (revalidatePath(path.split("?")[0]), redirect(`${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`));

export async function reviewVendorAction(fd: FormData) {
  const u = await requirePermission("vendor.approve");
  const id = String(fd.get("id"));
  const decision = z.enum(["APPROVE", "REJECT", "REQUEST_CHANGES"]).parse(fd.get("decision"));
  const note = String(fd.get("note") ?? "").trim() || null;
  if (decision !== "APPROVE" && !note) to(`/admin/vendors/${id}`, "error", "Add a note explaining what the applicant needs to do.");
  try { await reviewApplication(id, u.id, decision, note); } catch (e) { if (e instanceof VendorError) to(`/admin/vendors/${id}`, "error", e.message); throw e; }
  revalidatePath("/admin", "layout");
  to(`/admin/vendors/${id}`, "ok", "Decision recorded and the applicant has been notified.");
}

export async function suspendVendorAction(fd: FormData) {
  const u = await requirePermission("vendor.approve");
  const id = String(fd.get("id"));
  const suspend = fd.get("suspend") === "1";
  const reason = String(fd.get("reason") ?? "").trim();
  if (suspend && !reason) to(`/admin/vendors/${id}`, "error", "A reason is required to suspend a vendor.");
  await setVendorSuspended(id, u.id, suspend, reason || "Reinstated");
  to(`/admin/vendors/${id}`, "ok", suspend ? "Vendor suspended. Their listings are hidden." : "Vendor reinstated.");
}

export async function moderateListingAction(fd: FormData) {
  const u = await requirePermission("listing.moderate");
  const kind = String(fd.get("kind"));
  const id = String(fd.get("id"));
  const approve = fd.get("decision") === "approve";
  const reason = String(fd.get("reason") ?? "").trim() || undefined;
  if (!approve && !reason) to("/admin/listings", "error", "Give the seller a reason when rejecting.");
  try {
    if (kind === "service") {
      const s = await db.service.findUniqueOrThrow({ where: { id }, include: { vendor: true } });
      if (s.status !== "PENDING_REVIEW") throw new CatalogError("Only services awaiting review can be moderated.");
      await db.service.update({ where: { id }, data: { status: approve ? "PUBLISHED" : "REJECTED" } });
      await audit(db, { actorId: u.id, action: approve ? "service.approve" : "service.reject", entityType: "Service", entityId: id, after: { reason } });
      await notify(db, { userId: s.vendor.ownerId, type: "listing.review", title: approve ? `"${s.title}" is live` : `"${s.title}" needs changes`, body: approve ? "Customers can now book this service." : reason!, link: `/vendor/services/${id}` });
    } else {
      await moderateProduct(id, u.id, approve, reason);
    }
  } catch (e) {
    if (e instanceof CatalogError) to("/admin/listings", "error", e.message);
    throw e;
  }
  revalidatePath("/admin", "layout");
  to("/admin/listings", "ok", approve ? "Listing approved." : "Listing rejected; the seller has been told why.");
}

export async function toggleFeaturedAction(fd: FormData) {
  const u = await requirePermission("cms.manage");
  const id = String(fd.get("id"));
  const kind = String(fd.get("kind"));
  if (kind === "store") {
    const s = await db.store.findUniqueOrThrow({ where: { id } });
    await db.store.update({ where: { id }, data: { isFeatured: !s.isFeatured } });
  } else {
    const p = await db.product.findUniqueOrThrow({ where: { id } });
    await db.product.update({ where: { id }, data: { isFeatured: !p.isFeatured } });
  }
  await audit(db, { actorId: u.id, action: `${kind}.feature.toggle`, entityType: kind, entityId: id });
  revalidatePath("/admin/listings");
  revalidatePath("/");
}

export async function payoutDecisionAction(fd: FormData) {
  const u = await requirePermission("finance.payout.approve");
  const id = String(fd.get("id"));
  const op = String(fd.get("op"));
  try {
    if (op === "paid") {
      const ref = String(fd.get("ref") ?? "").trim();
      if (ref.length < 4) to("/admin/finance", "error", "Enter the bank transfer reference.");
      await markPayoutPaid(id, u.id, ref);
    } else {
      const reason = String(fd.get("reason") ?? "").trim() || "Rejected by finance";
      await failPayout(id, u.id, reason, op === "failed" ? "FAILED" : "REJECTED");
    }
  } catch (e) {
    if (e instanceof FinanceError) to("/admin/finance", "error", e.message);
    throw e;
  }
  revalidatePath("/admin", "layout");
  to("/admin/finance", "ok", "Payout updated.");
}

export async function runSettlementAction() {
  const u = await requirePermission("finance.payout.approve");
  const n = await releaseSettlements();
  await audit(db, { actorId: u.id, action: "settlement.run", entityType: "System", entityId: "settlement", after: { released: n } });
  to("/admin/finance", "ok", `${n} vendor order(s) settled.`);
}

export async function refundAction(fd: FormData) {
  const u = await requirePermission("finance.refund.approve");
  const id = String(fd.get("vendorOrderId"));
  const number = String(fd.get("number"));
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 4) to(`/admin/orders/${number}`, "error", "Give a refund reason.");
  try { await refundVendorOrder(id, u.id, reason); } catch (e) { if (e instanceof FinanceError) to(`/admin/orders/${number}`, "error", e.message); throw e; }
  to(`/admin/orders/${number}`, "ok", "Refund issued.");
}

export async function assignDeliveryAction(fd: FormData) {
  const u = await requirePermission("order.manage");
  const shipmentId = String(fd.get("shipmentId"));
  const partnerId = String(fd.get("partnerId")) || null;
  const number = String(fd.get("number"));
  if (partnerId) {
    const isPartner = await db.userRole.findFirst({ where: { userId: partnerId, role: { key: "DELIVERY_PARTNER" } } });
    if (!isPartner) to(`/admin/orders/${number}`, "error", "That user is not a delivery partner.");
  }
  await db.shipment.update({ where: { id: shipmentId }, data: { deliveryPartnerId: partnerId } });
  await audit(db, { actorId: u.id, action: "shipment.assign", entityType: "Shipment", entityId: shipmentId, after: { partnerId } });
  to(`/admin/orders/${number}`, "ok", "Delivery partner assigned.");
}

export async function setUserStatusAction(fd: FormData) {
  const u = await requirePermission("user.manage");
  const id = String(fd.get("id"));
  const status = z.enum(["ACTIVE", "SUSPENDED"]).parse(fd.get("status"));
  if (id === u.id) to(`/admin/users/${id}`, "error", "You can't suspend your own account.");
  const before = await db.user.findUniqueOrThrow({ where: { id } });
  await db.user.update({ where: { id }, data: { status } });
  if (status === "SUSPENDED") await db.session.deleteMany({ where: { userId: id } });
  await audit(db, { actorId: u.id, action: status === "SUSPENDED" ? "user.suspend" : "user.reactivate", entityType: "User", entityId: id, before: { status: before.status }, after: { status }, ip: await clientIp() });
  to(`/admin/users/${id}`, "ok", status === "SUSPENDED" ? "User suspended and signed out." : "User reactivated.");
}

export async function setUserRoleAction(fd: FormData) {
  const u = await requirePermission("staff.manage");
  const id = String(fd.get("id"));
  const role = String(fd.get("role"));
  const grant = fd.get("grant") === "1";
  const def = ROLES[role];
  if (!def || def.vendorScoped) to(`/admin/users/${id}`, "error", "Choose a platform role.");
  if (id === u.id && role === "SUPER_ADMIN" && !grant) to(`/admin/users/${id}`, "error", "You can't remove your own super admin role.");
  const r = await db.role.findUniqueOrThrow({ where: { key: role } });
  const existing = await db.userRole.findFirst({ where: { userId: id, roleId: r.id, vendorId: null } });
  if (grant && !existing) await db.userRole.create({ data: { userId: id, roleId: r.id } });
  if (!grant && existing) await db.userRole.delete({ where: { id: existing.id } });
  await audit(db, { actorId: u.id, action: grant ? "role.grant" : "role.revoke", entityType: "User", entityId: id, after: { role }, ip: await clientIp() });
  to(`/admin/users/${id}`, "ok", `${def!.name} ${grant ? "granted" : "removed"}.`);
}

export async function staffTicketReplyAction(fd: FormData) {
  const u = await requirePermission("support.respond");
  const number = String(fd.get("number"));
  const body = String(fd.get("body") ?? "").trim().slice(0, 5000);
  const internal = fd.get("internal") === "on";
  const status = z.enum(["OPEN", "PENDING_CUSTOMER", "ESCALATED", "RESOLVED", "CLOSED"]).parse(fd.get("status"));
  const t = await db.supportTicket.findUniqueOrThrow({ where: { number } });
  await db.$transaction(async (tx) => {
    if (body) await tx.ticketMessage.create({ data: { ticketId: t.id, authorId: u.id, body, internal } });
    await tx.supportTicket.update({ where: { id: t.id }, data: { status, assignedToId: t.assignedToId ?? u.id } });
    if (body && !internal) await notify(tx, { userId: t.userId, type: "support.update", title: `Update on ${t.number}`, body: body.slice(0, 200), link: `/account/support/${t.number}` });
  });
  to(`/admin/support/${number}`, "ok", "Ticket updated.");
}

export async function toggleSectionAction(fd: FormData) {
  const u = await requirePermission("cms.manage");
  const id = String(fd.get("id"));
  const s = await db.homepageSection.findUniqueOrThrow({ where: { id } });
  const op = String(fd.get("op"));
  if (op === "toggle") await db.homepageSection.update({ where: { id }, data: { active: !s.active } });
  if (op === "up" || op === "down") await db.homepageSection.update({ where: { id }, data: { sortOrder: s.sortOrder + (op === "up" ? -15 : 15) } });
  if (op === "save") await db.homepageSection.update({ where: { id }, data: { title: String(fd.get("title") ?? "") || null, subtitle: String(fd.get("subtitle") ?? "") || null } });
  await audit(db, { actorId: u.id, action: `cms.section.${op}`, entityType: "HomepageSection", entityId: id });
  revalidatePath("/");
  revalidatePath("/admin/content");
}

export async function saveBannerAction(fd: FormData) {
  const u = await requirePermission("cms.manage");
  const parsed = z.object({ id: z.string().optional(), placement: z.string().min(2), eyebrow: z.string().max(40).optional(), title: z.string().min(3).max(120), body: z.string().max(300).optional(), ctaLabel: z.string().max(40).optional(), ctaHref: z.string().max(200).regex(/^\/[^/]/, "Links must be internal paths starting with /").optional().or(z.literal("")), tone: z.enum(["blue", "charcoal", "light"]) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) to("/admin/content", "error", parsed.error.issues[0].message);
  const { id, ...d } = parsed.data!;
  const data = { ...d, eyebrow: d.eyebrow || null, body: d.body || null, ctaLabel: d.ctaLabel || null, ctaHref: d.ctaHref || null };
  const b = id ? await db.banner.update({ where: { id }, data }) : await db.banner.create({ data });
  await audit(db, { actorId: u.id, action: id ? "cms.banner.update" : "cms.banner.create", entityType: "Banner", entityId: b.id });
  revalidatePath("/");
  to("/admin/content", "ok", "Banner saved.");
}

export async function toggleBannerAction(fd: FormData) {
  await requirePermission("cms.manage");
  const b = await db.banner.findUniqueOrThrow({ where: { id: String(fd.get("id")) } });
  await db.banner.update({ where: { id: b.id }, data: { active: !b.active } });
  revalidatePath("/");
  revalidatePath("/admin/content");
}

export async function saveCommissionRuleAction(fd: FormData) {
  const u = await requirePermission("commission.manage");
  const parsed = z.object({ scope: z.enum(["GLOBAL", "CATEGORY", "VENDOR"]), targetId: z.string().optional(), rate: z.coerce.number().min(0).max(50), fixed: z.coerce.number().min(0).max(100000).default(0), name: z.string().min(2).max(80) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) to("/admin/finance", "error", parsed.error.issues[0].message);
  const d = parsed.data!;
  if (d.scope !== "GLOBAL" && !d.targetId) to("/admin/finance", "error", "Choose the category or vendor.");
  const data = { scope: d.scope, name: d.name, rateBps: Math.round(d.rate * 100), fixedMinor: BigInt(Math.round(d.fixed * 100)), categoryId: d.scope === "CATEGORY" ? d.targetId : null, vendorId: d.scope === "VENDOR" ? d.targetId : null };
  // One active rule per target: deactivate the previous one instead of editing (keeps history).
  const prev = await db.commissionRule.findMany({ where: { scope: d.scope, active: true, categoryId: data.categoryId, vendorId: data.vendorId } });
  await db.$transaction([
    db.commissionRule.updateMany({ where: { id: { in: prev.map((p) => p.id) } }, data: { active: false } }),
    db.commissionRule.create({ data }),
  ]);
  await audit(db, { actorId: u.id, action: "commission.set", entityType: "CommissionRule", entityId: d.scope, before: prev, after: data, ip: await clientIp() });
  to("/admin/finance", "ok", "Commission rule saved. It applies to new orders only.");
}

export async function deactivateCommissionRuleAction(fd: FormData) {
  const u = await requirePermission("commission.manage");
  const r = await db.commissionRule.findUniqueOrThrow({ where: { id: String(fd.get("id")) } });
  if (r.scope === "GLOBAL") to("/admin/finance", "error", "Replace the global rule instead of disabling it.");
  await db.commissionRule.update({ where: { id: r.id }, data: { active: false } });
  await audit(db, { actorId: u.id, action: "commission.disable", entityType: "CommissionRule", entityId: r.id });
  to("/admin/finance", "ok", "Rule disabled.");
}

export async function resolveReportAction(fd: FormData) {
  const u = await requirePermission("listing.moderate");
  const id = String(fd.get("id"));
  await db.report.update({ where: { id }, data: { status: String(fd.get("status")) === "ACTIONED" ? "ACTIONED" : "DISMISSED" } });
  await audit(db, { actorId: u.id, action: "report.resolve", entityType: "Report", entityId: id });
  revalidatePath("/admin/listings");
}
