"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { encryptJson, hint } from "@/server/crypto";
import { paymentAdapter, providerContext, shippingAdapter } from "@/server/integrations/registry";
import { approveAndInitiatePayout, payoutReference, reviewManualBeneficiary } from "@/server/services/payouts";
import { FinanceError } from "@/server/services/finance";
import { ingestWebhook, replayDeadLetter } from "@/server/services/webhooks";
import { sandboxPayoutCallback } from "@/server/integrations/payments/sandbox";
import { sandboxTrackingCallback } from "@/server/integrations/shipping/sandbox";
import { decideDispute, DisputeError, addEvidence } from "@/server/services/disputes";
import { resolveAlert } from "@/server/services/monitoring";
import { runReconciliation } from "@/server/services/reconciliation";
import { audit } from "@/server/services/audit";
import { clientIp } from "@/server/rate-limit";
import { parseNairaToMinor } from "@/lib/money";
import { slugify } from "@/lib/slug";
import { SETTING_DEFAULTS, type SettingKey } from "@/server/services/settings";
import { ROLES } from "@/server/auth/rbac";

const to = (path: string, k: "ok" | "error", m: string): never => {
  revalidatePath(path.split("?")[0]);
  redirect(`${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`);
};

// ─── Payouts ─────────────────────────────────────────────────────────────────

export async function approvePayoutAction(fd: FormData) {
  const u = await requirePermission("finance.payout.approve");
  const id = String(fd.get("id"));
  try {
    const r = await approveAndInitiatePayout(id, u.id);
    to(`/admin/payouts?id=${id}`, "ok", r.status === "APPROVED" ? "Approved. Record the bank reference after you transfer the funds." : r.status === "FAILED" ? "The provider rejected this payout; funds were returned to the vendor." : "Sent to the provider. It will be marked paid when the provider confirms.");
  } catch (e) {
    if (e instanceof FinanceError) to(`/admin/payouts?id=${id}`, "error", e.message);
    throw e;
  }
}

/** Sandbox only: deliver the simulator's callback through the real webhook pipeline. */
export async function simulatePayoutCallbackAction(fd: FormData) {
  await requirePermission("finance.payout.approve");
  const id = String(fd.get("id"));
  const p = await db.payout.findUniqueOrThrow({ where: { id } });
  if (!p.providerKey?.startsWith("sandbox-")) to(`/admin/payouts?id=${id}`, "error", "Only sandbox payouts can be simulated.");
  const outcome = fd.get("outcome") === "FAILED" ? "FAILED" : "SUCCESS";
  const cb = sandboxPayoutCallback(p.providerKey!, payoutReference(p.id), outcome, outcome === "FAILED" ? "Beneficiary account closed (sandbox)" : undefined);
  await ingestWebhook(p.providerKey!, cb.body, cb.headers);
  to(`/admin/payouts?id=${id}`, "ok", `Sandbox provider callback delivered: ${outcome}.`);
}

// ─── Integrations ────────────────────────────────────────────────────────────

const providerSchema = z.object({
  key: z.string(),
  active: z.enum(["on"]).optional(),
  mode: z.enum(["SANDBOX", "LIVE"]),
  approval: z.enum(["NOT_REQUIRED", "NOT_STARTED", "APPLIED", "APPROVED", "REJECTED"]),
  countries: z.string().max(200).optional(),
  currencies: z.string().max(200).optional(),
  methods: z.string().max(200).optional(),
  feeBps: z.coerce.number().int().min(0).max(2000).default(0),
  notes: z.string().max(2000).optional(),
});

export async function saveProviderAction(fd: FormData) {
  const u = await requirePermission("integrations.manage");
  const parsed = providerSchema.safeParse(Object.fromEntries(fd));
  const back = String(fd.get("back") || "/admin/integrations");
  if (!parsed.success) to(back, "error", parsed.error.issues[0].message);
  const d = parsed.data!;
  const adapter = paymentAdapter(d.key) ?? shippingAdapter(d.key);
  if (!adapter) to(back, "error", "Unknown provider.");
  const list = (s?: string) => (s ?? "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2,3}$/.test(x));
  const before = await db.integrationProvider.findUnique({ where: { key: d.key } });
  // Secrets: only replace when a new value was typed. Never echoed back.
  const creds: Record<string, string> = {};
  for (const f of adapter!.credentialFields) {
    const v = String(fd.get(`cred_${f.name}`) ?? "").trim();
    if (v) creds[f.name] = v;
  }
  let credentialsEnc = before?.credentialsEnc ?? null;
  let credentialHint = before?.credentialHint ?? null;
  if (Object.keys(creds).length) {
    const prev = before?.credentialsEnc ? (await providerContext(d.key)).credentials : {};
    const merged = { ...prev, ...creds };
    credentialsEnc = encryptJson(merged);
    const secretField = adapter!.credentialFields.find((f) => f.secret);
    credentialHint = secretField && merged[secretField.name] ? hint(merged[secretField.name]) : credentialHint;
  }
  if (d.active && adapter!.capabilities.length === 0) to(back, "error", `${adapter!.name} has no implemented capabilities yet and can't be activated.`);
  if (d.mode === "LIVE" && adapter!.status === "SANDBOX_SIMULATOR") to(back, "error", "Simulators can't be put in live mode.");
  if (d.mode === "LIVE" && d.active && !["APPROVED", "NOT_REQUIRED"].includes(d.approval)) to(back, "error", "Live mode requires the provider's approval to be recorded as Approved.");
  const data = {
    kind: adapter!.kind, name: adapter!.name, active: !!d.active, mode: d.mode, approval: d.approval,
    countries: list(d.countries), currencies: list(d.currencies), methods: (d.methods ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    feeBps: d.feeBps, notes: d.notes || null, credentialsEnc, credentialHint,
  };
  await db.integrationProvider.upsert({ where: { key: d.key }, update: data, create: { key: d.key, ...data } });
  await audit(db, { actorId: u.id, action: "integration.update", entityType: "IntegrationProvider", entityId: d.key, before: before ? { ...before, credentialsEnc: before.credentialsEnc ? "[encrypted]" : null, webhookSecretEnc: undefined } : null, after: { ...data, credentialsEnc: credentialsEnc ? "[encrypted]" : null, credentialsChanged: Object.keys(creds) }, ip: await clientIp() });
  to(back, "ok", `${adapter!.name} saved.`);
}

export async function testProviderAction(fd: FormData) {
  await requirePermission("integrations.manage");
  const key = String(fd.get("key"));
  const back = String(fd.get("back") || "/admin/integrations");
  const adapter = paymentAdapter(key) ?? shippingAdapter(key);
  if (!adapter?.testConnection) to(back, "error", "This provider has no connection test.");
  const ctx = await providerContext(key);
  let ok = false, message = "";
  try { ({ ok, message } = await adapter!.testConnection!(ctx)); } catch (e) { message = (e as Error).message; }
  await db.integrationProvider.update({ where: { key }, data: { lastCheckAt: new Date(), lastCheckOk: ok, lastCheckMessage: message.slice(0, 300) } }).catch(() => {});
  to(back, ok ? "ok" : "error", `${adapter!.name}: ${message}`);
}

export async function saveCorridorAction(fd: FormData) {
  const u = await requirePermission("integrations.manage");
  const id = String(fd.get("id"));
  const status = z.enum(["DISABLED", "SANDBOX", "LIVE"]).parse(fd.get("status"));
  const complianceApproved = fd.get("complianceApproved") === "on";
  const complianceNote = String(fd.get("complianceNote") ?? "").slice(0, 500) || null;
  const c = await db.payoutCorridor.findUniqueOrThrow({ where: { id } });
  const provider = await db.integrationProvider.findUnique({ where: { key: c.providerKey } });
  const adapter = paymentAdapter(c.providerKey);
  if (status === "LIVE") {
    if (!complianceApproved) to("/admin/integrations/payments", "error", "A live corridor needs compliance approval recorded.");
    if (!adapter || adapter.capabilities.length === 0 || adapter.status === "SANDBOX_SIMULATOR") to("/admin/integrations/payments", "error", `${adapter?.name ?? c.providerKey} can't run a live corridor.`);
    if (!provider?.active || provider.mode !== "LIVE" || !["APPROVED", "NOT_REQUIRED"].includes(provider.approval)) to("/admin/integrations/payments", "error", "Activate the provider in live mode with approval recorded first.");
  }
  if (status === "SANDBOX" && adapter?.status !== "SANDBOX_SIMULATOR" && provider?.mode !== "SANDBOX") to("/admin/integrations/payments", "error", "Sandbox corridors need a provider in sandbox mode.");
  await db.payoutCorridor.update({ where: { id }, data: { status, complianceApproved, complianceNote } });
  await audit(db, { actorId: u.id, action: "corridor.update", entityType: "PayoutCorridor", entityId: id, before: c, after: { status, complianceApproved, complianceNote }, ip: await clientIp() });
  to("/admin/integrations/payments", "ok", `${c.country} / ${c.currency} via ${c.providerKey}: ${status.toLowerCase()}.`);
}

export async function replayWebhookAction(fd: FormData) {
  await requirePermission("integrations.manage");
  const ok = await replayDeadLetter(String(fd.get("id")));
  to("/admin/integrations?tab=webhooks", ok ? "ok" : "error", ok ? "Event processed." : "Processing failed again; see the error.");
}

export async function resolveAlertAction(fd: FormData) {
  const u = await requirePermission("integrations.view");
  await resolveAlert(String(fd.get("key")), u.id);
  to(String(fd.get("back") || "/admin/integrations"), "ok", "Alert resolved.");
}

export async function runReconciliationAction() {
  const u = await requirePermission("finance.view");
  const r = await runReconciliation(7);
  await audit(db, { actorId: u.id, action: "reconciliation.run", entityType: "System", entityId: "reconciliation", after: r });
  to("/admin/finance?tab=reconciliation", r.mismatches ? "error" : "ok", `Checked ${r.payments} payments and ${r.payouts} payouts: ${r.mismatches} mismatches.`);
}

// ─── Shipping (sandbox tracking) ─────────────────────────────────────────────

export async function simulateTrackingAction(fd: FormData) {
  await requirePermission("order.manage");
  const id = String(fd.get("id"));
  const s = await db.shipment.findUniqueOrThrow({ where: { id } });
  if (s.providerKey !== "sandbox-shipping" || !s.providerShipmentId) to(`/admin/shipments?id=${id}`, "error", "Only sandbox shipments can be simulated.");
  const status = z.enum(["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_ATTEMPT"]).parse(fd.get("status"));
  const cb = sandboxTrackingCallback(s.providerShipmentId!, status, String(fd.get("note") || "") || undefined);
  await ingestWebhook("sandbox-shipping", cb.body, cb.headers);
  to(`/admin/shipments?id=${id}`, "ok", `Sandbox carrier event delivered: ${status.toLowerCase().replace(/_/g, " ")}.`);
}

// ─── Disputes ────────────────────────────────────────────────────────────────

export async function decideDisputeAction(fd: FormData) {
  const u = await requirePermission("dispute.decide");
  const id = String(fd.get("id"));
  const outcome = z.enum(["REFUND_CUSTOMER", "RELEASE_VENDOR"]).parse(fd.get("outcome"));
  try { await decideDispute(id, u.id, outcome, String(fd.get("resolution") ?? "")); } catch (e) { if (e instanceof DisputeError || e instanceof FinanceError) to(`/admin/disputes?id=${id}`, "error", e.message); throw e; }
  to(`/admin/disputes?id=${id}`, "ok", "Decision recorded and both parties notified.");
}

export async function staffDisputeNoteAction(fd: FormData) {
  const u = await requirePermission("dispute.decide");
  const id = String(fd.get("id"));
  try { await addEvidence(id, u.id, "STAFF", String(fd.get("body") ?? ""), {}); } catch (e) { if (e instanceof DisputeError) to(`/admin/disputes?id=${id}`, "error", e.message); throw e; }
  await db.dispute.update({ where: { id }, data: { status: "UNDER_REVIEW" } });
  to(`/admin/disputes?id=${id}`, "ok", "Note added.");
}

// ─── Catalogue ───────────────────────────────────────────────────────────────

export async function saveCategoryAction(fd: FormData) {
  const u = await requirePermission("category.manage");
  const parsed = z.object({ id: z.string().optional(), name: z.string().trim().min(2).max(60), parentId: z.string().optional(), kind: z.enum(["PRODUCT", "SERVICE", "DIGITAL"]), sortOrder: z.coerce.number().int().min(0).max(999).default(0), isFeatured: z.enum(["on"]).optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) to("/admin/categories", "error", parsed.error.issues[0].message);
  const d = parsed.data!;
  const data = { name: d.name, parentId: d.parentId || null, kind: d.kind, sortOrder: d.sortOrder, isFeatured: !!d.isFeatured };
  if (d.id) await db.category.update({ where: { id: d.id }, data });
  else {
    let slug = slugify(d.name);
    if (await db.category.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
    await db.category.create({ data: { ...data, slug } });
  }
  await audit(db, { actorId: u.id, action: d.id ? "category.update" : "category.create", entityType: "Category", entityId: d.id ?? d.name, after: data });
  to("/admin/categories", "ok", "Category saved.");
}

export async function moderateReviewAction(fd: FormData) {
  const u = await requirePermission("listing.moderate");
  const id = String(fd.get("id"));
  const status = z.enum(["PUBLISHED", "HIDDEN"]).parse(fd.get("status"));
  const r = await db.review.update({ where: { id }, data: { status } });
  if (r.productId) {
    const agg = await db.review.aggregate({ where: { productId: r.productId, status: "PUBLISHED" }, _avg: { rating: true }, _count: true });
    await db.product.update({ where: { id: r.productId }, data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count } });
  }
  await audit(db, { actorId: u.id, action: `review.${status.toLowerCase()}`, entityType: "Review", entityId: id });
  to("/admin/reviews", "ok", "Review updated.");
}

// ─── Subscriptions & promotions ──────────────────────────────────────────────

export async function savePlanAction(fd: FormData) {
  const u = await requirePermission("commission.manage");
  const parsed = z.object({ id: z.string(), name: z.string().trim().min(2).max(40), price: z.string(), listingLimit: z.string().optional(), commission: z.string().optional(), features: z.string().max(500), active: z.enum(["on"]).optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) to("/admin/subscriptions", "error", parsed.error.issues[0].message);
  const d = parsed.data!;
  const price = d.price.trim() === "" || d.price.trim() === "0" ? 0n : parseNairaToMinor(d.price);
  if (price == null) to("/admin/subscriptions", "error", "Enter a price in naira.");
  const commissionBps = d.commission?.trim() ? Math.round(Number(d.commission) * 100) : null;
  if (commissionBps != null && !(commissionBps >= 0 && commissionBps <= 5000)) to("/admin/subscriptions", "error", "Commission must be 0–50%.");
  const before = await db.subscriptionPlan.findUniqueOrThrow({ where: { id: d.id } });
  const plan = await db.subscriptionPlan.update({ where: { id: d.id }, data: { name: d.name, priceMinor: price!, listingLimit: d.listingLimit?.trim() ? Number(d.listingLimit) : null, commissionBps, features: d.features.split("\n").map((x) => x.trim()).filter(Boolean), active: !!d.active } });
  // Keep the plan's commission rule in step (most-specific-rule engine reads CommissionRule).
  await db.commissionRule.updateMany({ where: { scope: "SUBSCRIPTION", planKey: plan.key, active: true }, data: { active: false } });
  if (commissionBps != null) await db.commissionRule.create({ data: { scope: "SUBSCRIPTION", planKey: plan.key, name: `${plan.name} plan`, rateBps: commissionBps } });
  await audit(db, { actorId: u.id, action: "plan.update", entityType: "SubscriptionPlan", entityId: plan.id, before, after: plan, ip: await clientIp() });
  revalidatePath("/sell");
  to("/admin/subscriptions", "ok", `${plan.name} saved. New commission applies to new orders.`);
}

export async function assignPlanAction(fd: FormData) {
  const u = await requirePermission("commission.manage");
  const vendorId = String(fd.get("vendorId"));
  const planId = String(fd.get("planId"));
  const months = Math.min(12, Math.max(1, Number(fd.get("months") || 1)));
  const end = new Date(Date.now() + months * 30 * 864e5);
  await db.vendorSubscription.upsert({ where: { vendorId }, update: { planId, status: "ACTIVE", currentPeriodEnd: end, cancelAtPeriodEnd: false }, create: { vendorId, planId, status: "ACTIVE", currentPeriodEnd: end } });
  await audit(db, { actorId: u.id, action: "subscription.assign", entityType: "Vendor", entityId: vendorId, after: { planId, months } });
  to("/admin/subscriptions", "ok", "Plan assigned. Billing for paid plans is not automated yet — invoice the vendor separately.");
}

export async function createPlatformCouponAction(fd: FormData) {
  const u = await requirePermission("cms.manage");
  const parsed = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, "Codes are 4–20 letters/numbers"), type: z.enum(["PERCENT", "FIXED"]), value: z.string(), minSubtotal: z.string().optional(), maxDiscount: z.string().optional(), maxUses: z.coerce.number().int().min(1).optional(), endsAt: z.string().optional() }).safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => v !== "")));
  if (!parsed.success) to("/admin/promotions", "error", parsed.error.issues[0].message);
  const d = parsed.data!;
  const value = d.type === "PERCENT" ? Math.round(Number(d.value) * 100) : Number(parseNairaToMinor(d.value) ?? 0n);
  if (!(value > 0) || (d.type === "PERCENT" && value > 9000)) to("/admin/promotions", "error", "Enter a valid discount.");
  if (await db.coupon.findUnique({ where: { code: d.code } })) to("/admin/promotions", "error", "That code exists.");
  await db.coupon.create({ data: { code: d.code, vendorId: null, type: d.type, value, minSubtotalMinor: d.minSubtotal ? parseNairaToMinor(d.minSubtotal) ?? 0n : 0n, maxDiscountMinor: d.maxDiscount ? parseNairaToMinor(d.maxDiscount) : null, maxUses: d.maxUses, endsAt: d.endsAt ? new Date(d.endsAt) : null } });
  await audit(db, { actorId: u.id, action: "coupon.create", entityType: "Coupon", entityId: d.code });
  to("/admin/promotions", "ok", `Platform-funded coupon ${d.code} created.`);
}

export async function toggleAnyCouponAction(fd: FormData) {
  const u = await requirePermission("cms.manage");
  const c = await db.coupon.findUniqueOrThrow({ where: { id: String(fd.get("id")) } });
  await db.coupon.update({ where: { id: c.id }, data: { active: !c.active } });
  await audit(db, { actorId: u.id, action: c.active ? "coupon.pause" : "coupon.resume", entityType: "Coupon", entityId: c.code });
  to("/admin/promotions", "ok", "Coupon updated.");
}

// ─── Staff & settings ────────────────────────────────────────────────────────

export async function grantStaffRoleByEmailAction(fd: FormData) {
  const u = await requirePermission("staff.manage");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const role = String(fd.get("role"));
  if (!ROLES[role]?.staff) to("/admin/staff", "error", "Choose a staff role.");
  const target = await db.user.findUnique({ where: { email } });
  if (!target) to("/admin/staff", "error", "No account with that email. Ask them to register first.");
  if (!target!.emailVerifiedAt) to("/admin/staff", "error", "That account hasn't verified its email.");
  const r = await db.role.findUniqueOrThrow({ where: { key: role } });
  if (!(await db.userRole.findFirst({ where: { userId: target!.id, roleId: r.id, vendorId: null } }))) await db.userRole.create({ data: { userId: target!.id, roleId: r.id } });
  await audit(db, { actorId: u.id, action: "role.grant", entityType: "User", entityId: target!.id, after: { role }, ip: await clientIp() });
  to("/admin/staff", "ok", `${ROLES[role].name} granted to ${email}. They must set up two-step verification before the back office opens.`);
}

export async function resetStaffMfaAction(fd: FormData) {
  const u = await requirePermission("staff.manage");
  const id = String(fd.get("id"));
  if (id === u.id) to("/admin/staff", "error", "You can't reset your own two-step verification here.");
  await db.$transaction([
    db.user.update({ where: { id }, data: { mfaEnabledAt: null, mfaSecret: null, mfaRecoveryCodes: [] } }),
    db.session.deleteMany({ where: { userId: id } }),
  ]);
  await audit(db, { actorId: u.id, action: "mfa.reset", entityType: "User", entityId: id, ip: await clientIp() });
  to("/admin/staff", "ok", "Two-step verification reset and the user signed out. They'll enrol again on next sign-in.");
}

export async function saveSettingsAction(fd: FormData) {
  const u = await requirePermission("settings.manage");
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
    const raw = fd.get(key);
    if (raw == null) continue;
    const def = SETTING_DEFAULTS[key];
    let value: unknown;
    if (typeof def === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100_000) to("/admin/settings", "error", `${key} must be a positive number.`);
      value = n;
    } else {
      if (key === "shippingSelection") {
        const v = String(raw).trim().toUpperCase();
        if (!["CHEAPEST", "FASTEST", "RECOMMENDED", "MANUAL"].includes(v)) to("/admin/settings", "error", "Courier selection must be CHEAPEST, FASTEST, RECOMMENDED or MANUAL.");
        value = v;
      } else if (key === "minPayoutMinor") {
        const m = parseNairaToMinor(String(raw));
        if (m == null) to("/admin/settings", "error", "Minimum payout must be a naira amount.");
        value = m!.toString();
      } else value = String(raw);
    }
    changes[key] = value;
    await db.platformSetting.upsert({ where: { key }, update: { value: value as never }, create: { key, value: value as never } });
  }
  await audit(db, { actorId: u.id, action: "settings.update", entityType: "PlatformSetting", entityId: "platform", after: changes, ip: await clientIp() });
  to("/admin/settings", "ok", "Settings saved.");
}

export async function reviewBeneficiaryAction(fd: FormData) {
  const u = await requirePermission("finance.payout.approve");
  const id = String(fd.get("id"));
  const decision = String(fd.get("decision")) === "VERIFIED" ? "VERIFIED" : "REJECTED";
  try { await reviewManualBeneficiary(id, u.id, decision, String(fd.get("note") ?? "")); } catch (e) { if (e instanceof FinanceError) to("/admin/beneficiaries?status=PENDING_VERIFICATION", "error", e.message); throw e; }
  to("/admin/beneficiaries?status=PENDING_VERIFICATION", "ok", decision === "VERIFIED" ? "Account verified." : "Account rejected; the vendor has been told why.");
}
