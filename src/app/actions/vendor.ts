"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { FulfilmentError, updateVendorOrderStatus } from "@/server/services/orders";
import { FinanceError, refundVendorOrder, requestPayout } from "@/server/services/finance";
import { setBookingStatus } from "@/server/services/bookings";
import { CartError } from "@/server/services/cart";
import { saveImage, UploadError } from "@/server/storage";
import { parseNairaToMinor } from "@/lib/money";
import { slugify } from "@/lib/slug";
import { NIGERIAN_STATES } from "@/lib/validation";
import type { VendorOrderStatus } from "@prisma/client";

const to = (path: string, k: "ok" | "error", m: string) => (revalidatePath(path.split("?")[0]), redirect(`${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`));

export async function vendorOrderStatusAction(fd: FormData) {
  const { vendorId, user } = await requireVendor("orders");
  const id = String(fd.get("id"));
  const next = String(fd.get("next")) as VendorOrderStatus;
  const path = `/vendor/orders/${id}`;
  try {
    if (next === "CANCELLED") {
      const vo = await db.vendorOrder.findFirst({ where: { id, vendorId } });
      if (!vo || !["NEW", "PROCESSING"].includes(vo.status)) throw new FulfilmentError("Only orders that haven't shipped can be cancelled.");
      const reason = String(fd.get("reason") ?? "").trim() || "Cancelled by seller";
      await refundVendorOrder(id, user.id, reason);
    } else {
      await updateVendorOrderStatus(vendorId, id, next, user.id, { carrier: String(fd.get("carrier") ?? "") || undefined, trackingNumber: String(fd.get("trackingNumber") ?? "") || undefined });
    }
  } catch (e) {
    if (e instanceof FulfilmentError || e instanceof FinanceError) to(path, "error", e.message);
    throw e;
  }
  revalidatePath("/vendor", "layout");
  to(path, "ok", next === "CANCELLED" ? "Order cancelled and the buyer refunded." : "Order updated. The buyer has been notified.");
}

export async function requestPayoutAction(fd: FormData) {
  const { vendorId, user } = await requireVendor("finance");
  const amount = parseNairaToMinor(String(fd.get("amount") ?? ""));
  if (amount == null) to("/vendor/earnings", "error", "Enter an amount in naira.");
  try {
    await requestPayout(vendorId, amount!, user.id, String(fd.get("key") || randomUUID()));
  } catch (e) {
    if (e instanceof FinanceError) to("/vendor/earnings", "error", e.message);
    throw e;
  }
  to("/vendor/earnings", "ok", "Withdrawal requested. Finance reviews requests every business day.");
}

export async function saveStoreSettingsAction(fd: FormData) {
  const { vendorId } = await requireVendor("settings");
  const parsed = z.object({
    name: z.string().trim().min(2).max(80), tagline: z.string().trim().max(120).optional(), description: z.string().trim().max(3000).optional(),
    contactEmail: z.string().trim().email().optional().or(z.literal("")), contactPhone: z.string().trim().max(20).optional(),
    returnPolicy: z.string().trim().max(2000).optional(), city: z.string().trim().max(80).optional(), state: z.enum(NIGERIAN_STATES).optional().or(z.literal("")),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) to("/vendor/settings", "error", parsed.error.issues[0].message);
  const d = parsed.data!;
  const update: Record<string, unknown> = { name: d.name, tagline: d.tagline || null, description: d.description || null, contactEmail: d.contactEmail || null, contactPhone: d.contactPhone || null, returnPolicy: d.returnPolicy || null, city: d.city || null, state: d.state || null };
  try {
    for (const k of ["logo", "banner"] as const) {
      const f = fd.get(k);
      if (f instanceof File && f.size > 0) update[`${k}Url`] = (await saveImage(f, `stores/${vendorId}`)).url;
    }
  } catch (e) {
    if (e instanceof UploadError) to("/vendor/settings", "error", e.message);
    throw e;
  }
  await db.store.update({ where: { vendorId }, data: update });
  revalidatePath("/vendor", "layout");
  to("/vendor/settings", "ok", "Store updated.");
}

export async function addShippingMethodAction(fd: FormData) {
  const { vendorId } = await requireVendor("settings");
  const parsed = z.object({
    name: z.string().trim().min(2).max(60), type: z.enum(["FLAT", "WEIGHT", "PICKUP"]), rate: z.string(), perKg: z.string().optional(), freeOver: z.string().optional(),
    states: z.string().optional(), etaMin: z.coerce.number().int().min(0).max(60), etaMax: z.coerce.number().int().min(0).max(90),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) to("/vendor/settings", "error", "Check the delivery option fields.");
  const d = parsed.data!;
  const rate = d.type === "PICKUP" ? 0n : parseNairaToMinor(d.rate);
  if (rate == null) to("/vendor/settings", "error", "Enter a delivery price in naira.");
  if (d.etaMax < d.etaMin) to("/vendor/settings", "error", "Maximum delivery days must be at least the minimum.");
  const states = (d.states ?? "").split(",").map((s) => s.trim()).filter((s) => (NIGERIAN_STATES as readonly string[]).includes(s));
  await db.shippingMethod.create({
    data: { vendorId, name: d.name, type: d.type, rateMinor: rate!, perKgMinor: d.perKg ? parseNairaToMinor(d.perKg) ?? 0n : 0n, freeOverMinor: d.freeOver ? parseNairaToMinor(d.freeOver) : null, states, etaDaysMin: d.etaMin, etaDaysMax: d.etaMax },
  });
  to("/vendor/settings", "ok", "Delivery option added.");
}

export async function toggleShippingMethodAction(fd: FormData) {
  const { vendorId } = await requireVendor("settings");
  const m = await db.shippingMethod.findFirst({ where: { id: String(fd.get("id")), vendorId } });
  if (m) await db.shippingMethod.update({ where: { id: m.id }, data: { active: !m.active } });
  revalidatePath("/vendor/settings");
}

export async function bookingStatusAction(fd: FormData) {
  const { vendorId, user } = await requireVendor("services");
  const next = z.enum(["CONFIRMED", "COMPLETED", "CANCELLED"]).parse(fd.get("next"));
  try {
    await setBookingStatus(vendorId, String(fd.get("id")), next, user.id, String(fd.get("reason") ?? "") || undefined);
  } catch (e) {
    if (e instanceof CartError || e instanceof FinanceError) to("/vendor/bookings", "error", e.message);
    throw e;
  }
  to("/vendor/bookings", "ok", "Booking updated. The customer has been notified.");
}

const serviceSchema = z.object({
  title: z.string().trim().min(5).max(120), categoryId: z.string().min(1, "Choose a category"), summary: z.string().trim().max(200).optional(),
  description: z.string().trim().min(30, "Description must be at least 30 characters").max(8000), location: z.enum(["ONSITE", "REMOTE", "BOTH"]),
  city: z.string().trim().max(80).optional(), state: z.enum(NIGERIAN_STATES).optional().or(z.literal("")), cancellationPolicy: z.string().trim().max(1000).optional(),
});

export async function saveServiceAction(fd: FormData) {
  const { vendorId, vendor } = await requireVendor("services");
  const id = String(fd.get("id") || "") || null;
  const path = `/vendor/services/${id ?? "new"}`;
  const parsed = serviceSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) to(path, "error", parsed.error.issues[0].message);
  const d = parsed.data!;
  const packages = (["BASIC", "STANDARD", "PREMIUM"] as const).map((tier) => ({
    tier, name: String(fd.get(`${tier}_name`) ?? "").trim(), description: String(fd.get(`${tier}_desc`) ?? "").trim(),
    priceMinor: parseNairaToMinor(String(fd.get(`${tier}_price`) ?? "")), durationMinutes: Number(fd.get(`${tier}_mins`) || 60), deliveryDays: Number(fd.get(`${tier}_days`) || 0) || null,
  })).filter((p) => p.name && p.priceMinor);
  if (!packages.length) to(path, "error", "Add at least one package with a name and price.");
  if (packages.some((p) => !Number.isInteger(p.durationMinutes) || p.durationMinutes < 15 || p.durationMinutes > 720)) to(path, "error", "Session length must be between 15 minutes and 12 hours.");
  const availability: { weekday: number; startMinute: number; endMinute: number }[] = [];
  for (let wd = 0; wd < 7; wd++) {
    if (fd.get(`day_${wd}`) !== "on") continue;
    const [sh, sm] = String(fd.get(`start_${wd}`) || "09:00").split(":").map(Number);
    const [eh, em] = String(fd.get(`end_${wd}`) || "17:00").split(":").map(Number);
    const s = sh * 60 + sm, e = eh * 60 + em;
    if (!(e > s)) to(path, "error", "Closing time must be after opening time.");
    availability.push({ weekday: wd, startMinute: s, endMinute: e });
  }
  const data = { ...d, summary: d.summary || null, city: d.city || null, state: d.state || null, cancellationPolicy: d.cancellationPolicy || null };
  const existing = id ? await db.service.findFirst({ where: { id, vendorId, deletedAt: null } }) : null;
  if (id && !existing) redirect("/vendor/services");
  const submit = fd.get("intent") === "submit" && vendor.status === "APPROVED";
  const svc = await db.$transaction(async (tx) => {
    const s = existing
      ? await tx.service.update({ where: { id: existing.id }, data: { ...data, ...(submit ? { status: "PENDING_REVIEW" } : {}) } })
      : await tx.service.create({ data: { ...data, vendorId, slug: `${slugify(d.title)}-${Date.now().toString(36)}`, status: submit ? "PENDING_REVIEW" : "DRAFT" } });
    for (const p of packages) await tx.servicePackage.upsert({ where: { serviceId_tier: { serviceId: s.id, tier: p.tier } }, update: { ...p, priceMinor: p.priceMinor! }, create: { ...p, priceMinor: p.priceMinor!, serviceId: s.id } });
    await tx.servicePackage.deleteMany({ where: { serviceId: s.id, tier: { notIn: packages.map((p) => p.tier) }, bookings: { none: {} } } });
    await tx.serviceAvailability.deleteMany({ where: { serviceId: s.id } });
    if (availability.length) await tx.serviceAvailability.createMany({ data: availability.map((a) => ({ ...a, serviceId: s.id })) });
    return s;
  });
  revalidatePath("/vendor/services");
  to(`/vendor/services/${svc.id}`, "ok", submit ? "Submitted for review." : "Saved.");
}

export async function createCouponAction(fd: FormData) {
  const { vendorId } = await requireVendor("catalog");
  const parsed = z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, "Codes are 4–20 letters or numbers"),
    type: z.enum(["PERCENT", "FIXED"]), value: z.string(), minSubtotal: z.string().optional(), maxUses: z.coerce.number().int().min(1).max(100000).optional(), endsAt: z.string().optional(),
  }).safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => v !== "")));
  if (!parsed.success) to("/vendor/marketing", "error", parsed.error.issues[0].message);
  const d = parsed.data!;
  let value: number;
  if (d.type === "PERCENT") {
    const pct = Number(d.value);
    if (!(pct > 0 && pct <= 90)) to("/vendor/marketing", "error", "Percentage must be between 1 and 90.");
    value = Math.round(pct * 100);
  } else {
    const v = parseNairaToMinor(d.value);
    if (!v || v > 2_000_000_000n) to("/vendor/marketing", "error", "Enter a naira amount.");
    value = Number(v);
  }
  if (await db.coupon.findUnique({ where: { code: d.code } })) to("/vendor/marketing", "error", "That code is already taken.");
  await db.coupon.create({ data: { code: d.code, vendorId, type: d.type, value: value!, minSubtotalMinor: d.minSubtotal ? parseNairaToMinor(d.minSubtotal) ?? 0n : 0n, maxUses: d.maxUses, endsAt: d.endsAt ? new Date(d.endsAt) : null } });
  to("/vendor/marketing", "ok", `Coupon ${d.code} created.`);
}

export async function toggleCouponAction(fd: FormData) {
  const { vendorId } = await requireVendor("catalog");
  const c = await db.coupon.findFirst({ where: { id: String(fd.get("id")), vendorId } });
  if (c) await db.coupon.update({ where: { id: c.id }, data: { active: !c.active } });
  revalidatePath("/vendor/marketing");
}
