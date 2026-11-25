"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { assertEditable, getApplication, startApplication, submitApplication, uniqueStoreSlug, VendorError, VENDOR_AGREEMENT_VERSION } from "@/server/services/vendors";
import { saveImage, savePrivateDocument, UploadError } from "@/server/storage";
import { parseNairaToMinor } from "@/lib/money";
import { NIGERIAN_STATES, phoneNg, email } from "@/lib/validation";
import { countryByCode, isIntlPhone } from "@/lib/countries";
import { addBeneficiary, beneficiaryProvidersFor } from "@/server/services/payouts";
import { parseBeneficiaryForm } from "@/server/services/beneficiary-form";
import { FinanceError } from "@/server/services/finance";

const back = (step: number, error?: string) => (revalidatePath("/sell/apply"), redirect(`/sell/apply?step=${step}${error ? `&error=${encodeURIComponent(error)}` : ""}`));

async function current() {
  const u = await requireUser("/sell/apply");
  const v = await getApplication(u.id);
  return { u, v };
}

export async function chooseTypeAction(fd: FormData) {
  const { u } = await current();
  const type = z.enum(["INDIVIDUAL", "BUSINESS", "SERVICE_PROVIDER"]).safeParse(fd.get("type"));
  if (!type.success) back(2, "Choose how you'll sell.");
  try {
    const existing = await getApplication(u.id);
    if (existing) {
      assertEditable(existing.status);
      await db.vendor.update({ where: { id: existing.id }, data: { type: type.data, onboardingStep: Math.max(existing.onboardingStep, 3) } });
    } else {
      await startApplication(u.id, type.data!);
      await db.vendor.updateMany({ where: { ownerId: u.id }, data: { onboardingStep: 3 } });
    }
  } catch (e) {
    if (e instanceof VendorError) back(2, e.message);
    throw e;
  }
  back(3);
}

const businessSchema = z.object({
  businessName: z.string().trim().min(2, "Enter your business or trading name").max(120),
  description: z.string().trim().min(30, "Describe what you sell in at least 30 characters").max(2000),
  businessCategory: z.string().trim().min(2, "Choose a category").max(80),
  email, phone: z.string().trim().max(30),
  country: z.string().trim().length(2, "Choose your country"),
  website: z.string().trim().url("Enter a full URL, e.g. https://…").max(200).optional().or(z.literal("")),
  instagram: z.string().trim().max(100).optional(),
  addressLine1: z.string().trim().min(3, "Enter your business address").max(200),
  city: z.string().trim().min(2, "Enter a city").max(80),
  state: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(),
  rcNumber: z.string().trim().max(20).optional(),
});

export async function saveBusinessAction(fd: FormData) {
  const { v } = await current();
  if (!v) back(2);
  try { assertEditable(v!.status); } catch (e) { back(3, (e as Error).message); }
  const parsed = businessSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) back(3, parsed.error.issues[0].message);
  const d = parsed.data!;
  const country = countryByCode(d.country);
  if (!country) back(3, "We don't accept vendors from that country yet.");
  const ng = country!.code === "NG";
  const phone = ng ? phoneNg.safeParse(d.phone) : null;
  if (ng && !phone!.success) back(3, phone!.error.issues[0].message);
  if (!ng && !isIntlPhone(d.phone)) back(3, `Enter your phone number with the country code, e.g. ${country!.phonePrefix}…`);
  if (ng && !(NIGERIAN_STATES as readonly string[]).includes(d.state ?? "")) back(3, "Choose a state");
  if (!ng && !(d.region && d.region.length >= 2)) back(3, "Enter your province, state or region");
  if (v!.type === "BUSINESS" && !d.rcNumber) back(3, ng ? "Registered businesses must provide a CAC RC/BN number." : "Registered businesses must provide their company registration number.");
  const countryChanged = v!.country !== country!.code;
  await db.$transaction(async (tx) => {
    await tx.vendor.update({
      where: { id: v!.id },
      data: {
        businessName: d.businessName, description: d.description, businessCategory: d.businessCategory, email: d.email, phone: ng ? phone!.data! : d.phone.replace(/[\s()-]/g, ""), website: d.website || null,
        socialLinks: d.instagram ? { instagram: d.instagram } : undefined, addressLine1: d.addressLine1, city: d.city,
        country: country!.code, state: ng ? d.state! : null, region: ng ? null : d.region!, payoutCurrency: country!.currency,
        rcNumber: d.rcNumber || null, onboardingStep: Math.max(v!.onboardingStep, 4),
      },
    });
    // Bank accounts must be in the registration country; retire any added under a previous country.
    if (countryChanged) await tx.beneficiary.updateMany({ where: { vendorId: v!.id, country: { not: country!.code }, status: { not: "DISABLED" } }, data: { status: "DISABLED", disabledAt: new Date(), isDefault: false, detailsEnc: null } });
  });
  back(4);
}

export async function uploadDocumentAction(fd: FormData) {
  const { v } = await current();
  if (!v) back(2);
  try { assertEditable(v!.status); } catch (e) { back(4, (e as Error).message); }
  const type = z.enum(["GOVERNMENT_ID", "CAC_CERTIFICATE", "UTILITY_BILL", "PROFESSIONAL_CERTIFICATE"]).safeParse(fd.get("type"));
  const file = fd.get("file");
  if (!type.success || !(file instanceof File) || file.size === 0) back(4, "Choose a document type and file.");
  try {
    const saved = await savePrivateDocument(file as File, `kyc/${v!.id}`);
    await db.vendorDocument.create({ data: { vendorId: v!.id, type: type.data!, fileKey: saved.key, fileName: (file as File).name.slice(0, 120) } });
    await db.vendor.update({ where: { id: v!.id }, data: { onboardingStep: Math.max(v!.onboardingStep, 5) } });
  } catch (e) {
    if (e instanceof UploadError) back(4, e.message);
    throw e;
  }
  back(4);
}

export async function saveStoreAction(fd: FormData) {
  const { v } = await current();
  if (!v) back(2);
  try { assertEditable(v!.status); } catch (e) { back(5, (e as Error).message); }
  const parsed = z.object({
    name: z.string().trim().min(2, "Enter a store name").max(80),
    tagline: z.string().trim().max(120).optional(),
    storeDescription: z.string().trim().max(2000).optional(),
    contactEmail: z.string().trim().email().optional().or(z.literal("")),
    contactPhone: z.string().trim().max(20).optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) back(5, parsed.error.issues[0].message);
  const d = parsed.data!;
  let logoUrl: string | undefined;
  const logo = fd.get("logo");
  if (logo instanceof File && logo.size > 0) {
    try { logoUrl = (await saveImage(logo, `stores/${v!.id}`)).url; } catch (e) { if (e instanceof UploadError) back(5, e.message); throw e; }
  }
  const slug = v!.store?.slug ?? (await uniqueStoreSlug(d.name, v!.id));
  const data = { name: d.name, tagline: d.tagline || null, description: d.storeDescription || null, contactEmail: d.contactEmail || null, contactPhone: d.contactPhone || null, city: v!.city, state: v!.state, ...(logoUrl ? { logoUrl } : {}) };
  await db.store.upsert({ where: { vendorId: v!.id }, update: data, create: { ...data, vendorId: v!.id, slug } });
  await db.vendor.update({ where: { id: v!.id }, data: { onboardingStep: Math.max(v!.onboardingStep, 6) } });
  back(6);
}

export async function savePayoutAction(fd: FormData) {
  const { u, v } = await current();
  if (!v) back(2);
  if (fd.get("skip") === "1") {
    // Allowed only when no payout route exists for the vendor's country yet; they add an account later.
    if ((await beneficiaryProvidersFor(v!.country, v!.payoutCurrency)).length > 0) back(6, "Add a bank account to continue.");
    await db.vendor.update({ where: { id: v!.id }, data: { onboardingStep: Math.max(v!.onboardingStep, 7) } });
    back(v!.type === "SERVICE_PROVIDER" ? 8 : 7);
  }
  const f = parseBeneficiaryForm(fd, v!);
  if (!f.ok) back(6, f.error);
  const { providerKey, input } = f as Extract<typeof f, { ok: true }>;
  try {
    const r = await addBeneficiary(v!.id, u.id, providerKey, input);
    if (r.beneficiary.status === "REJECTED") back(6, r.beneficiary.failureReason ?? "The payment provider could not verify this account.");
  } catch (e) {
    if (e instanceof FinanceError) back(6, e.message);
    throw e;
  }
  await db.vendor.update({ where: { id: v!.id }, data: { onboardingStep: Math.max(v!.onboardingStep, 7) } });
  back(v!.type === "SERVICE_PROVIDER" ? 8 : 7);
}

export async function saveShippingAction(fd: FormData) {
  const { v } = await current();
  if (!v) back(2);
  const local = parseNairaToMinor(String(fd.get("localRate") ?? ""));
  const national = parseNairaToMinor(String(fd.get("nationalRate") ?? ""));
  const freeOver = String(fd.get("freeOver") ?? "").trim() ? parseNairaToMinor(String(fd.get("freeOver"))) : null;
  const pickup = fd.get("pickup") === "on" && v!.country === "NG";
  if (v!.country !== "NG" && national == null) back(7, "Set your price for delivery to buyers in Nigeria.");
  if (local == null && national == null && !pickup) back(7, "Add at least one delivery option.");
  await db.shippingMethod.deleteMany({ where: { vendorId: v!.id } });
  const rows = [];
  if (local != null) rows.push({ vendorId: v!.id, name: `Within ${v!.state ?? v!.region ?? "my region"}`, type: "FLAT" as const, rateMinor: local, states: v!.state ? [v!.state] : [], etaDaysMin: 1, etaDaysMax: 3, freeOverMinor: freeOver });
  if (national != null) rows.push({ vendorId: v!.id, name: v!.country === "NG" ? "Nationwide delivery" : "Delivery to Nigeria", destinationCountries: v!.country === "NG" ? [] : ["NG"], type: "FLAT" as const, rateMinor: national, states: [], etaDaysMin: 3, etaDaysMax: 7, freeOverMinor: freeOver });
  if (pickup) rows.push({ vendorId: v!.id, name: "Pick up from seller", type: "PICKUP" as const, rateMinor: 0n, states: [], etaDaysMin: 0, etaDaysMax: 2 });
  await db.shippingMethod.createMany({ data: rows });
  await db.vendor.update({ where: { id: v!.id }, data: { onboardingStep: Math.max(v!.onboardingStep, 8) } });
  back(8);
}

export async function acceptAgreementAndSubmitAction(fd: FormData) {
  const { u, v } = await current();
  if (!v) back(2);
  if (fd.get("agree") !== "on") back(8, "You need to accept the vendor agreement.");
  await db.vendor.update({ where: { id: v!.id }, data: { agreementAcceptedAt: new Date(), agreementVersion: VENDOR_AGREEMENT_VERSION } });
  try {
    await submitApplication(v!.id, u.id);
  } catch (e) {
    if (e instanceof VendorError) back(8, e.message);
    throw e;
  }
  revalidatePath("/sell/apply");
  redirect("/sell/apply?submitted=1");
}
