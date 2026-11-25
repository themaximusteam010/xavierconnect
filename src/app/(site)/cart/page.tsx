import Link from "next/link";
import { ShoppingBag, Trash2 } from "lucide-react";
import { db } from "@/server/db";
import { readCartIdent } from "@/server/cart-ident";
import { loadCartView } from "@/server/services/cart";
import { applyCouponAction, updateCartItemAction } from "@/app/actions/cart";
import { ProductImage } from "@/components/commerce/product-image";
import { VerifiedMark } from "@/components/commerce/verified";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Your cart", robots: { index: false } };

export default async function CartPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const view = await loadCartView(db, await readCartIdent());
  if (!view || view.items.length === 0) {
    return (
      <div className="container-x py-12">
        <h1 className="mb-6 text-2xl font-semibold">Your cart</h1>
        <EmptyState icon={ShoppingBag} title="Your cart is empty" action={<ButtonLink href="/shop">Continue shopping</ButtonLink>}>Items you add will appear here, grouped by seller.</EmptyState>
      </div>
    );
  }
  const { pricing, items } = view;
  const byId = new Map(items.map((i) => [i.id, i]));

  return (
    <div className="container-x py-10">
      <h1 className="text-2xl font-semibold">Your cart</h1>
      <p className="mt-1 text-sm text-ink-muted">{pricing.vendors.length > 1 ? `Items from ${pricing.vendors.length} sellers. You pay once; each seller ships their own items.` : "Review your items before checkout."}</p>
      {error && <Alert tone="danger" className="mt-4">{error}</Alert>}
      {view.issues.map((m) => <Alert key={m} tone="warning" className="mt-4">{m}</Alert>)}

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {pricing.vendors.map((v) => {
            const first = byId.get(v.lines[0].key)!;
            const store = first.product.vendor.store!;
            return (
              <section key={v.vendorId} className="rounded-lg border border-line" aria-label={`Items from ${store.name}`}>
                <header className="flex items-center justify-between border-b border-line bg-canvas px-4 py-3 text-sm">
                  <Link href={`/store/${store.slug}`} className="flex items-center gap-1 font-medium hover:text-brand">{store.name}<VerifiedMark level={first.product.vendor.verificationLevel} /></Link>
                  <span className="tabular text-ink-muted">Subtotal {formatMoney(v.subtotalMinor)}</span>
                </header>
                <ul className="divide-y divide-line">
                  {v.lines.map((l) => {
                    const it = byId.get(l.key)!;
                    const variant = it.variantKey ? it.product.variants.find((x) => x.id === it.variantKey) : null;
                    return (
                      <li key={l.key} className="grid grid-cols-[72px_1fr] gap-4 p-4 sm:grid-cols-[88px_1fr_auto]">
                        <Link href={`/p/${it.product.slug}`}><ProductImage src={it.product.images[0]?.url} alt={it.product.name} className="rounded-md" /></Link>
                        <div className="min-w-0">
                          <Link href={`/p/${it.product.slug}`} className="line-clamp-2 text-sm font-medium hover:text-brand">{it.product.name}</Link>
                          {variant && <p className="text-[13px] text-ink-muted">{variant.name}</p>}
                          <p className="tabular mt-1 text-[13px] text-ink-muted">{formatMoney(l.unitPriceMinor)} each</p>
                          <div className="mt-3 flex items-center gap-3">
                            {it.product.type === "PHYSICAL" ? (
                              <form action={updateCartItemAction} className="flex items-center gap-2">
                                <input type="hidden" name="itemId" value={it.id} />
                                <label className="sr-only" htmlFor={`q-${it.id}`}>Quantity</label>
                                <select id={`q-${it.id}`} name="quantity" defaultValue={it.quantity} className="h-8 rounded-md border border-line-strong px-2 text-sm">
                                  {Array.from({ length: Math.max(10, it.quantity) }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
                                </select>
                                <button className="text-[13px] font-medium text-brand">Update</button>
                              </form>
                            ) : <span className="text-[13px] text-ink-muted">Digital download</span>}
                            <form action={updateCartItemAction}>
                              <input type="hidden" name="itemId" value={it.id} /><input type="hidden" name="quantity" value="0" />
                              <button className="flex items-center gap-1 text-[13px] text-ink-muted hover:text-danger"><Trash2 className="size-3.5" />Remove</button>
                            </form>
                          </div>
                        </div>
                        <p className="tabular col-start-2 text-sm font-semibold sm:col-start-3 sm:text-right">{formatMoney(l.lineTotalMinor)}</p>
                      </li>
                    );
                  })}
                </ul>
                {v.lines.some((l) => l.kind === "PHYSICAL") && (
                  <footer className="border-t border-line px-4 py-2.5 text-[13px] text-ink-muted">
                    Delivery: {view.shippingByVendor[v.vendorId] ? `${(view.shippingByVendor[v.vendorId] as { name?: string }).name} · ${v.shippingMinor === 0n ? "Free" : formatMoney(v.shippingMinor)}` : <span className="text-danger">This seller has no delivery option yet</span>}
                  </footer>
                )}
              </section>
            );
          })}
        </div>

        <aside className="h-fit space-y-4 rounded-lg border border-line p-5 lg:sticky lg:top-6">
          <h2 className="font-semibold">Order summary</h2>
          <dl className="tabular space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-ink-muted">Items</dt><dd>{formatMoney(pricing.subtotalMinor)}</dd></div>
            {pricing.discountMinor > 0n && <div className="flex justify-between text-success"><dt>Discount ({view.couponCode})</dt><dd>−{formatMoney(pricing.discountMinor)}</dd></div>}
            <div className="flex justify-between"><dt className="text-ink-muted">Delivery</dt><dd>{pricing.shippingMinor === 0n ? "Free" : formatMoney(pricing.shippingMinor)}</dd></div>
            {pricing.taxMinor > 0n && <div className="flex justify-between"><dt className="text-ink-muted">VAT</dt><dd>{formatMoney(pricing.taxMinor)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-3 text-base font-semibold"><dt>Total</dt><dd>{formatMoney(pricing.totalMinor)}</dd></div>
          </dl>
          <form action={applyCouponAction} className="flex gap-2">
            <label htmlFor="code" className="sr-only">Discount code</label>
            <Input id="code" name="code" placeholder="Discount code" defaultValue={view.couponCode ?? ""} className="h-9 uppercase" />
            <SubmitButton variant="secondary" size="sm" className="h-9">{view.couponCode ? "Update" : "Apply"}</SubmitButton>
          </form>
          {view.couponCode && pricing.couponMessage && <p className="text-[13px] text-warning">{pricing.couponMessage}</p>}
          <ButtonLink href="/checkout" size="lg" className="w-full">Checkout</ButtonLink>
          <p className="text-center text-[12px] text-ink-muted">Guest checkout available. Delivery options can be changed at checkout.</p>
        </aside>
      </div>
    </div>
  );
}
