import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { saveProductAction, removeImageAction } from "@/app/actions/vendor-products";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { minorToInput } from "@/lib/money";

export const metadata = { title: "Edit product" };

function Section({ title, children, description }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export default async function EditProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string; type?: string }> }) {
  const { vendorId, vendor } = await requireVendor("catalog");
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === "new";
  const p = isNew ? null : await db.product.findFirst({ where: { id, vendorId, deletedAt: null }, include: { images: { orderBy: { sortOrder: "asc" } }, variants: true, digitalAssets: { orderBy: { createdAt: "desc" } } } });
  if (!isNew && !p) notFound();
  const type = p?.type ?? (sp.type === "DIGITAL" ? "DIGITAL" : "PHYSICAL");
  const cats = await db.category.findMany({ where: { kind: type === "DIGITAL" ? "DIGITAL" : "PRODUCT" }, orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }], include: { parent: true } });
  const attrs = (p?.attributes ?? {}) as Record<string, string>;
  const variantText = p?.variants.map((v) => `${v.name} | ${v.stockQuantity}${v.priceMinor ? ` | ${minorToInput(v.priceMinor)}` : ""}`).join("\n") ?? "";
  const canSubmit = vendor.status === "APPROVED" && (!p || ["DRAFT", "REJECTED", "ARCHIVED"].includes(p.status));

  return (
    <>
      <PageHeader
        eyebrow={isNew ? undefined : "Product"}
        title={isNew ? (type === "DIGITAL" ? "New digital product" : "New product") : p!.name}
        description={p ? <span className="flex items-center gap-2"><StatusBadge status={p.status} />{p.status === "PUBLISHED" && <Link href={`/p/${p.slug}`} className="text-brand underline">View live listing</Link>}</span> : <>Selling a file? <Link href="/vendor/products/new?type=DIGITAL" className="text-brand underline">Create a digital product</Link> instead.</>}
      />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      {p?.status === "REJECTED" && p.rejectionReason && <div className="mb-6 rounded-md border border-red-200 bg-danger-soft px-4 py-3 text-sm text-danger"><b>Reviewer note:</b> {p.rejectionReason}</div>}

      <form action={saveProductAction} className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <input type="hidden" name="id" value={p?.id ?? ""} />
        <input type="hidden" name="type" value={type} />
        <div className="space-y-6">
          <Section title="Basics">
            <Field label="Product name" htmlFor="name" required><Input id="name" name="name" defaultValue={p?.name} maxLength={150} required /></Field>
            <Field label="Category" htmlFor="categoryId" required>
              <Select id="categoryId" name="categoryId" defaultValue={p?.categoryId ?? ""} required>
                <option value="">Choose a category</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.parent ? `${c.parent.name} › ${c.name}` : c.name}</option>)}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Brand" htmlFor="brand"><Input id="brand" name="brand" defaultValue={p?.brand ?? ""} /></Field>
              <Field label="SKU" htmlFor="sku" hint="Your own stock code."><Input id="sku" name="sku" defaultValue={p?.sku ?? ""} /></Field>
            </div>
            <Field label="Short description" htmlFor="shortDescription" hint="One or two sentences shown near the price."><Textarea id="shortDescription" name="shortDescription" rows={2} maxLength={300} defaultValue={p?.shortDescription ?? ""} /></Field>
            <Field label="Full description" htmlFor="description" required><Textarea id="description" name="description" rows={8} defaultValue={p?.description ?? ""} required minLength={20} /></Field>
          </Section>

          <Section title="Photos" description="JPG, PNG or WebP up to 5 MB each. The first photo is the main image. Use real photos of the item you're selling.">
            {p && p.images.length > 0 && (
              <ul className="flex flex-wrap gap-3">
                {p.images.map((im) => (
                  <li key={im.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im.url} alt={im.alt} className="size-24 rounded-md border border-line object-cover" />
                    <SubmitButton formAction={removeImageAction} name="imageId" value={im.id} formNoValidate size="sm" variant="ghost" className="absolute right-1 top-1 !h-6 bg-white/90 !px-1.5 text-[11px] text-danger shadow">Remove</SubmitButton>
                  </li>
                ))}
              </ul>
            )}
            <input type="file" name="images" multiple accept="image/jpeg,image/png,image/webp" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-sunken file:px-3 file:py-2 file:text-sm" />
          </Section>

          {type === "DIGITAL" ? (
            <Section title="File delivered to buyers" description="Stored privately. Buyers get a time-limited, download-limited link after payment is verified.">
              {p?.digitalAssets[0] && <p className="text-sm">Current file: <b>{p.digitalAssets[0].fileName}</b> · v{p.digitalAssets[0].version} · {(p.digitalAssets[0].sizeBytes / 1_048_576).toFixed(1)} MB. Uploading a new file creates a new version for future buyers.</p>}
              <input type="file" name="asset" accept="application/pdf,application/zip,image/png,image/jpeg" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-sunken file:px-3 file:py-2 file:text-sm" />
              <Field label="Licence terms" htmlFor="licenceTerms"><Textarea id="licenceTerms" name="licenceTerms" rows={2} defaultValue={p?.licenceTerms ?? "Personal and single-business commercial use. Do not resell or redistribute."} /></Field>
            </Section>
          ) : (
            <>
              <Section title="Inventory and options" description="Leave options empty for a single item. One option per line: name | stock | price (price optional).">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Stock quantity" htmlFor="stockQuantity" hint="Ignored when options are set."><Input id="stockQuantity" name="stockQuantity" type="number" min={0} defaultValue={p?.stockQuantity ?? 0} /></Field>
                  <Field label="Low-stock alert at" htmlFor="lowStockThreshold"><Input id="lowStockThreshold" name="lowStockThreshold" type="number" min={0} defaultValue={p?.lowStockThreshold ?? 5} /></Field>
                </div>
                <Field label="Options" htmlFor="variants"><Textarea id="variants" name="variants" rows={4} defaultValue={variantText} placeholder={"Black / M | 10\nBlack / L | 6 | 26500"} className="font-mono text-[13px]" /></Field>
              </Section>
              <Section title="Details and shipping">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Material" htmlFor="material"><Input id="material" name="material" defaultValue={attrs.material ?? ""} /></Field>
                  <Field label="Model" htmlFor="model"><Input id="model" name="model" defaultValue={attrs.model ?? ""} /></Field>
                  <Field label="Colour" htmlFor="colour"><Input id="colour" name="colour" defaultValue={attrs.colour ?? ""} /></Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Weight (grams)" htmlFor="weightGrams" hint="Used for weight-based delivery."><Input id="weightGrams" name="weightGrams" type="number" min={0} defaultValue={p?.weightGrams ?? ""} /></Field>
                  <Field label="Warranty" htmlFor="warranty"><Input id="warranty" name="warranty" defaultValue={p?.warranty ?? ""} placeholder="e.g. 6 months manufacturer warranty" /></Field>
                </div>
                <Field label="Return terms" htmlFor="returnInfo" hint="Leave blank to use the marketplace 7-day policy."><Input id="returnInfo" name="returnInfo" defaultValue={p?.returnInfo ?? ""} /></Field>
              </Section>
            </>
          )}

          <Section title="Search and SEO">
            <Field label="Tags" htmlFor="tags" hint="Comma-separated words buyers might search for."><Input id="tags" name="tags" defaultValue={p?.tags.join(", ") ?? ""} /></Field>
            <Field label="SEO title" htmlFor="seoTitle" hint="Up to 70 characters."><Input id="seoTitle" name="seoTitle" maxLength={70} defaultValue={p?.seoTitle ?? ""} /></Field>
            <Field label="SEO description" htmlFor="seoDescription" hint="Up to 160 characters."><Textarea id="seoDescription" name="seoDescription" rows={2} maxLength={160} defaultValue={p?.seoDescription ?? ""} /></Field>
          </Section>
        </div>

        <aside className="space-y-6 xl:sticky xl:top-20 xl:h-fit">
          <Section title="Pricing">
            <Field label="Price (₦)" htmlFor="price" required><Input id="price" name="price" inputMode="decimal" defaultValue={minorToInput(p?.priceMinor)} required /></Field>
            <Field label="Sale price (₦)" htmlFor="salePrice" hint="Optional. Must be lower than the price."><Input id="salePrice" name="salePrice" inputMode="decimal" defaultValue={minorToInput(p?.salePriceMinor)} /></Field>
            <Field label="Publish on" htmlFor="publishAt" hint="Optional. Leave empty to publish as soon as approved."><Input id="publishAt" name="publishAt" type="datetime-local" defaultValue={p?.publishAt ? p.publishAt.toISOString().slice(0, 16) : ""} /></Field>
          </Section>
          <div className="space-y-2">
            {canSubmit && <SubmitButton name="intent" value="submit" className="w-full" pendingLabel="Submitting…">Save and submit for review</SubmitButton>}
            <SubmitButton name="intent" value="draft" variant="secondary" className="w-full" pendingLabel="Saving…">{p?.status === "PUBLISHED" ? "Save changes" : "Save draft"}</SubmitButton>
            {vendor.status !== "APPROVED" && <p className="text-[12px] text-ink-muted">You can submit listings for review once your store is approved.</p>}
            {p?.status === "PUBLISHED" && <p className="text-[12px] text-ink-muted">Changing the name, description or category sends the listing back for review.</p>}
          </div>
        </aside>
      </form>
    </>
  );
}
