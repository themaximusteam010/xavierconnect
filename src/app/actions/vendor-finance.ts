"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { FinanceError } from "@/server/services/finance";
import { addBeneficiary, disableBeneficiary, setDefaultBeneficiary } from "@/server/services/payouts";
import { buyLabel, getShippingQuotes, ShippingError } from "@/server/services/shipping";
import { audit } from "@/server/services/audit";
import { isIntlPhone, VENDOR_COUNTRIES } from "@/lib/countries";
import { parseBeneficiaryForm } from "@/server/services/beneficiary-form";
import { parseNairaToMinor } from "@/lib/money";

const to = (path: string, k: "ok" | "error", m: string) => (revalidatePath(path.split("?")[0]), redirect(`${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`));

export async function addBeneficiaryAction(fd: FormData) {
  const { vendorId, vendor, user } = await requireVendor("finance");
  const path = "/vendor/bank-accounts";
  const f = parseBeneficiaryForm(fd, vendor);
  if (!f.ok) to(path, "error", f.error);
  const { providerKey, input } = f as Extract<typeof f, { ok: true }>;
  try {
    const r = await addBeneficiary(vendorId, user.id, providerKey, input);
    to(path, r.beneficiary.status === "REJECTED" ? "error" : "ok", r.beneficiary.status === "VERIFIED" ? "Account verified and ready for withdrawals." : r.beneficiary.status === "REJECTED" ? (r.beneficiary.failureReason ?? "The provider rejected this account.") : (r.message ?? "Account submitted for verification."));
  } catch (e) {
    if (e instanceof FinanceError) to(path, "error", e.message);
    throw e;
  }
}

export async function beneficiaryOpAction(fd: FormData) {
  const { vendorId, user } = await requireVendor("finance");
  const id = String(fd.get("id"));
  const op = String(fd.get("op"));
  try {
    if (op === "default") await setDefaultBeneficiary(vendorId, id, user.id);
    else if (op === "disable") await disableBeneficiary(vendorId, id, user.id);
  } catch (e) {
    if (e instanceof FinanceError) to("/vendor/bank-accounts", "error", e.message);
    throw e;
  }
  to("/vendor/bank-accounts", "ok", op === "default" ? "Default account updated." : "Account removed.");
}

// ─── Shipping ────────────────────────────────────────────────────────────────

export async function savePickupAddressAction(fd: FormData) {
  const { vendorId, vendor, user } = await requireVendor("settings");
  const path = "/vendor/shipping";
  const parsed = z.object({
    id: z.string().optional(), label: z.string().trim().min(2).max(40), contactName: z.string().trim().min(2).max(80),
    phone: z.string().trim().refine(isIntlPhone, "Enter the phone number with country code, e.g. +234…"), email: z.string().trim().email("Enter a valid email"),
    line1: z.string().trim().min(4, "Enter the street address").max(200), line2: z.string().trim().max(200).optional(), city: z.string().trim().min(2).max(80),
    region: z.string().trim().min(2, "Enter the state, province or region").max(80), postalCode: z.string().trim().max(20).optional(), isDefault: z.literal("on").optional(),
  }).safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => v !== "")));
  if (!parsed.success) to(path, "error", parsed.error.issues[0].message);
  const { id, isDefault, ...d } = parsed.data!;
  // Pickup addresses are in the vendor's registration country (export origin for customs).
  const data = { ...d, country: vendor.country, line2: d.line2 ?? null, postalCode: d.postalCode ?? null, providerAddressCodes: undefined };
  const count = await db.pickupAddress.count({ where: { vendorId } });
  const makeDefault = !!isDefault || count === 0;
  await db.$transaction(async (tx) => {
    if (makeDefault) await tx.pickupAddress.updateMany({ where: { vendorId }, data: { isDefault: false } });
    if (id) {
      const own = await tx.pickupAddress.findFirst({ where: { id, vendorId } });
      if (!own) throw new Error("not found");
      // Address changed → cached carrier address codes are stale.
      await tx.pickupAddress.update({ where: { id }, data: { ...data, providerAddressCodes: {}, isDefault: makeDefault || own.isDefault } });
    } else await tx.pickupAddress.create({ data: { ...data, vendorId, isDefault: makeDefault } });
  });
  await audit(db, { actorId: user.id, action: id ? "pickup.update" : "pickup.create", entityType: "Vendor", entityId: vendorId });
  to(path, "ok", "Pickup address saved.");
}

export async function deletePickupAddressAction(fd: FormData) {
  const { vendorId } = await requireVendor("settings");
  await db.pickupAddress.deleteMany({ where: { id: String(fd.get("id")), vendorId } });
  to("/vendor/shipping", "ok", "Pickup address removed.");
}

export async function saveShippingPrefsAction(fd: FormData) {
  const { vendorId, user } = await requireVendor("settings");
  const handlingDays = Math.round(Number(fd.get("handlingDays")));
  if (!(handlingDays >= 0 && handlingDays <= 30)) to("/vendor/shipping", "error", "Handling time must be 0–30 days.");
  await db.vendor.update({ where: { id: vendorId }, data: { handlingDays, internationalShipping: fd.get("internationalShipping") === "on" } });
  await audit(db, { actorId: user.id, action: "vendor.shipping_prefs", entityType: "Vendor", entityId: vendorId, after: { handlingDays } });
  to("/vendor/shipping", "ok", "Shipping preferences saved.");
}

export async function addIntlShippingMethodAction(fd: FormData) {
  const { vendorId, vendor } = await requireVendor("settings");
  const path = "/vendor/shipping";
  const parsed = z.object({ name: z.string().trim().min(2).max(60), rate: z.string(), perKg: z.string().optional(), etaMin: z.coerce.number().int().min(0).max(90), etaMax: z.coerce.number().int().min(0).max(120) }).safeParse(Object.fromEntries([...fd.entries()].filter(([k]) => k !== "dest")));
  if (!parsed.success) to(path, "error", "Check the delivery option fields.");
  const d = parsed.data!;
  const rate = parseNairaToMinor(d.rate);
  if (rate == null) to(path, "error", "Enter the delivery price in naira (buyers pay in naira).");
  if (d.etaMax < d.etaMin) to(path, "error", "Maximum delivery days must be at least the minimum.");
  const codes = new Set<string>(VENDOR_COUNTRIES.map((c) => c.code));
  const destinations = fd.getAll("dest").map((x) => String(x).trim().toUpperCase()).filter((x) => codes.has(x) && x !== vendor.country);
  if (!destinations.length) to(path, "error", "Choose at least one destination country other than your own.");
  await db.shippingMethod.create({ data: { vendorId, name: d.name, type: "WEIGHT", rateMinor: rate!, perKgMinor: d.perKg ? parseNairaToMinor(d.perKg) ?? 0n : 0n, states: [], destinationCountries: destinations, etaDaysMin: d.etaMin, etaDaysMax: d.etaMax } });
  if (!vendor.internationalShipping) await db.vendor.update({ where: { id: vendorId }, data: { internationalShipping: true } });
  to(path, "ok", "International delivery option added.");
}

export async function quoteShipmentAction(fd: FormData) {
  const { vendorId } = await requireVendor("orders");
  const vo = String(fd.get("vendorOrderId"));
  const path = `/vendor/shipments?order=${vo}`;
  const dims = { length: Number(fd.get("length")), width: Number(fd.get("width")), height: Number(fd.get("height")) };
  if (![dims.length, dims.width, dims.height].every((n) => Number.isFinite(n) && n > 0 && n <= 300)) to(path, "error", "Enter parcel dimensions in centimetres.");
  try {
    const r = await getShippingQuotes(vendorId, vo, String(fd.get("providerKey")), String(fd.get("pickupAddressId")), dims);
    to(path, r.rows.length ? "ok" : "error", r.rows.length ? `${r.rows.length} rate(s) received. Quotes expire in 30 minutes.` : "The carrier returned no rates for this route.");
  } catch (e) {
    if (e instanceof ShippingError) to(path, "error", e.message);
    throw e;
  }
}

export async function buyLabelAction(fd: FormData) {
  const { vendorId, user } = await requireVendor("orders");
  const vo = String(fd.get("vendorOrderId"));
  const path = `/vendor/shipments?order=${vo}`;
  let customs;
  if (fd.get("international") === "1") {
    const value = parseNairaToMinor(String(fd.get("declaredValue") ?? ""));
    const contents = String(fd.get("contents") ?? "").trim();
    const hs = String(fd.get("hsCodes") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (contents.length < 3) to(path, "error", "Describe the contents for customs.");
    if (value == null || value <= 0n) to(path, "error", "Enter the declared customs value.");
    if (hs.some((h) => !/^\d{6,10}$/.test(h.replace(/\./g, "")))) to(path, "error", "HS codes are 6–10 digits.");
    customs = { contents, declaredValueMinor: value!, currency: "NGN", hsCodes: hs, incoterm: (fd.get("incoterm") === "DDP" ? "DDP" : "DAP") as "DAP" | "DDP", insured: fd.get("insured") === "on" };
  }
  try {
    await buyLabel(vendorId, String(fd.get("quoteId")), user.id, customs);
  } catch (e) {
    if (e instanceof ShippingError) to(path, "error", e.message);
    throw e;
  }
  revalidatePath("/vendor", "layout");
  to(`/vendor/shipments?order=${vo}`, "ok", "Label created. The order is marked shipped and the buyer has tracking.");
}
