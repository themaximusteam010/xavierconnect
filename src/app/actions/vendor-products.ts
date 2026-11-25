"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { CatalogError, submitProductForReview, uniqueProductSlug } from "@/server/services/catalog";
import { saveDigitalAsset, saveImage, UploadError } from "@/server/storage";
import { parseNairaToMinor } from "@/lib/money";
import { audit } from "@/server/services/audit";

const money = (label: string, required: boolean) =>
  z.string().trim().transform((s, ctx) => {
    if (!s) { if (required) ctx.addIssue({ code: "custom", message: `Enter a ${label}` }); return null; }
    const v = parseNairaToMinor(s);
    if (v == null || v <= 0n) { ctx.addIssue({ code: "custom", message: `Enter a valid ${label} in naira` }); return null; }
    return v;
  });

const productSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters").max(150),
  categoryId: z.string().min(1, "Choose a category"),
  type: z.enum(["PHYSICAL", "DIGITAL"]),
  price: money("price", true),
  salePrice: money("sale price", false),
  stockQuantity: z.coerce.number().int().min(0).max(1_000_000).default(0),
  lowStockThreshold: z.coerce.number().int().min(0).max(10_000).default(5),
  sku: z.string().trim().max(60).optional(),
  brand: z.string().trim().max(80).optional(),
  shortDescription: z.string().trim().max(300).optional(),
  description: z.string().trim().min(20, "Description must be at least 20 characters").max(10_000),
  weightGrams: z.coerce.number().int().min(0).max(1_000_000).optional(),
  material: z.string().trim().max(80).optional(),
  model: z.string().trim().max(80).optional(),
  colour: z.string().trim().max(80).optional(),
  tags: z.string().trim().max(300).optional(),
  warranty: z.string().trim().max(200).optional(),
  returnInfo: z.string().trim().max(500).optional(),
  licenceTerms: z.string().trim().max(1000).optional(),
  seoTitle: z.string().trim().max(70).optional(),
  seoDescription: z.string().trim().max(160).optional(),
  variants: z.string().max(5000).optional(),
  publishAt: z.string().optional(),
});

function parseVariants(text: string | undefined) {
  if (!text?.trim()) return [];
  return text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 50).map((line) => {
    const [name, stock, price] = line.split("|").map((s) => s.trim());
    const p = price ? parseNairaToMinor(price) : null;
    if (!name || !/^\d+$/.test(stock ?? "")) throw new CatalogError(`Variant line "${line}" should look like: Black / XL | 10 | 25000`);
    return { name: name.slice(0, 80), stockQuantity: Number(stock), priceMinor: p, options: { option: name } };
  });
}

export async function saveProductAction(fd: FormData) {
  const { vendorId, user, vendor } = await requireVendor("catalog");
  const id = String(fd.get("id") ?? "") || null;
  const intent = String(fd.get("intent") ?? "draft");
  const errUrl = (m: string) => `/vendor/products/${id ?? "new"}?error=${encodeURIComponent(m)}`;
  const parsed = productSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) redirect(errUrl(parsed.error.issues[0].message));
  const d = parsed.data;
  if (d.salePrice != null && d.price != null && d.salePrice >= d.price) redirect(errUrl("Sale price must be lower than the regular price."));
  const category = await db.category.findUnique({ where: { id: d.categoryId } });
  if (!category || category.kind === "SERVICE") redirect(errUrl("Choose a product category."));

  // Plan listing limit
  if (!id) {
    const sub = await db.vendorSubscription.findUnique({ where: { vendorId }, include: { plan: true } });
    const limit = sub?.plan.listingLimit ?? (await db.subscriptionPlan.findUnique({ where: { key: "STARTER" } }))?.listingLimit ?? null;
    if (limit != null && (await db.product.count({ where: { vendorId, deletedAt: null } })) >= limit) redirect(errUrl(`Your plan allows ${limit} listings. Upgrade to add more.`));
  }

  let variants: ReturnType<typeof parseVariants> = [];
  try { variants = parseVariants(d.variants); } catch (e) { redirect(errUrl((e as Error).message)); }

  const existing = id ? await db.product.findFirst({ where: { id, vendorId, deletedAt: null } }) : null;
  if (id && !existing) redirect("/vendor/products");
  const data = {
    name: d.name, categoryId: d.categoryId, type: d.type, priceMinor: d.price!, salePriceMinor: d.salePrice,
    stockQuantity: variants.length ? variants.reduce((a, v) => a + v.stockQuantity, 0) : d.stockQuantity,
    lowStockThreshold: d.lowStockThreshold, trackInventory: d.type === "PHYSICAL",
    sku: d.sku || null, brand: d.brand || null, shortDescription: d.shortDescription || null, description: d.description,
    weightGrams: d.weightGrams || null, attributes: { material: d.material || "", model: d.model || "", colour: d.colour || "" },
    tags: (d.tags ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 15),
    warranty: d.warranty || null, returnInfo: d.returnInfo || null, licenceTerms: d.licenceTerms || null,
    seoTitle: d.seoTitle || null, seoDescription: d.seoDescription || null,
    publishAt: d.publishAt ? new Date(d.publishAt) : null,
  };
  // Material edits to a live listing send it back to review.
  const priceOrTextChanged = existing && existing.status === "PUBLISHED" && (existing.name !== d.name || existing.description !== d.description || existing.categoryId !== d.categoryId);

  let productId = id;
  try {
    const p = existing
      ? await db.product.update({ where: { id: existing.id }, data: { ...data, ...(priceOrTextChanged ? { status: "PENDING_REVIEW" as const } : {}) } })
      : await db.product.create({ data: { ...data, vendorId, slug: await uniqueProductSlug(d.name) } });
    productId = p.id;

    if (variants.length || existing) {
      await db.productVariant.deleteMany({ where: { productId: p.id } });
      if (variants.length) await db.productVariant.createMany({ data: variants.map((v) => ({ ...v, productId: p.id })) });
    }

    const images = fd.getAll("images").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 8);
    const start = await db.productImage.count({ where: { productId: p.id } });
    if (start + images.length > 10) throw new CatalogError("A product can have up to 10 images.");
    for (const [i, f] of images.entries()) {
      const saved = await saveImage(f, `products/${vendorId}`);
      await db.productImage.create({ data: { productId: p.id, url: saved.url, alt: d.name, sortOrder: start + i } });
    }
    const asset = fd.get("asset");
    if (d.type === "DIGITAL" && asset instanceof File && asset.size > 0) {
      const saved = await saveDigitalAsset(asset, `digital/${vendorId}`);
      const prev = await db.digitalAsset.findFirst({ where: { productId: p.id }, orderBy: { createdAt: "desc" } });
      const version = prev ? `${(parseFloat(prev.version) + 0.1).toFixed(1)}` : "1.0";
      await db.digitalAsset.create({ data: { productId: p.id, fileKey: saved.key, fileName: asset.name.slice(0, 150), format: saved.ext, sizeBytes: saved.size, version } });
    }
    if (intent === "submit") {
      if (vendor.status !== "APPROVED") throw new CatalogError("Your store must be approved before listings can be submitted.");
      await submitProductForReview(vendorId, p.id, user.id);
    }
  } catch (e) {
    if (e instanceof UploadError || e instanceof CatalogError) redirect(`/vendor/products/${productId ?? "new"}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/vendor/products");
  redirect(`/vendor/products/${productId}?ok=${encodeURIComponent(intent === "submit" ? "Submitted for review." : priceOrTextChanged ? "Saved. Your changes will go live after review." : "Saved.")}`);
}

export async function productBulkAction(fd: FormData) {
  const { vendorId, user } = await requireVendor("catalog");
  const ids = fd.getAll("ids").map(String).slice(0, 200);
  const op = String(fd.get("op"));
  if (!ids.length) return;
  const where = { id: { in: ids }, vendorId, deletedAt: null };
  if (op === "archive") await db.product.updateMany({ where, data: { status: "ARCHIVED" } });
  if (op === "delete") await db.product.updateMany({ where, data: { deletedAt: new Date(), status: "ARCHIVED" } });
  if (op === "submit") for (const id of ids) await submitProductForReview(vendorId, id, user.id).catch(() => {});
  if (op === "duplicate") {
    for (const id of ids) {
      const p = await db.product.findFirst({ where: { id, vendorId }, include: { images: true, variants: true } });
      if (!p) continue;
      const { id: _id, slug: _s, createdAt: _c, updatedAt: _u, ratingAvg: _r, ratingCount: _rc, salesCount: _sc, viewCount: _vc, images, variants, attributes, ...rest } = p;
      await db.product.create({
        data: { ...rest, attributes: attributes ?? undefined, name: `${p.name} (copy)`, slug: await uniqueProductSlug(`${p.name} copy`), status: "DRAFT", isFeatured: false, images: { create: images.map(({ url, alt, sortOrder }) => ({ url, alt, sortOrder })) }, variants: { create: variants.map(({ name, sku, options, priceMinor, stockQuantity }) => ({ name, sku, options: options ?? {}, priceMinor, stockQuantity })) } },
      });
    }
  }
  await audit(db, { actorId: user.id, action: `product.bulk.${op}`, entityType: "Vendor", entityId: vendorId, after: { ids } });
  revalidatePath("/vendor/products");
}

export async function removeImageAction(fd: FormData) {
  const { vendorId } = await requireVendor("catalog");
  const imageId = String(fd.get("imageId"));
  const img = await db.productImage.findFirst({ where: { id: imageId, product: { vendorId } } });
  if (img) await db.productImage.delete({ where: { id: img.id } });
  revalidatePath(`/vendor/products/${img?.productId}`);
}

export async function adjustStockAction(fd: FormData) {
  const { vendorId } = await requireVendor("catalog");
  const id = String(fd.get("id"));
  const qty = Number(fd.get("stock"));
  if (!Number.isInteger(qty) || qty < 0 || qty > 1_000_000) return;
  await db.product.updateMany({ where: { id, vendorId, type: "PHYSICAL", variants: { none: {} } }, data: { stockQuantity: qty } });
  revalidatePath("/vendor/products");
}
