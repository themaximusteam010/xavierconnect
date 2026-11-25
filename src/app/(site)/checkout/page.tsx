import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { readCartIdent } from "@/server/cart-ident";
import { loadCartView } from "@/server/services/cart";
import { CheckoutForm } from "@/components/checkout-form";
import { AutoSubmitSelect } from "@/components/commerce/auto-submit-select";
import { formatMoney } from "@/lib/money";
import { Alert } from "@/components/ui/feedback";

export const metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const choice: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (k.startsWith("ship_")) choice[k.slice(5)] = v;
  const user = await getCurrentUser();
  const view = await loadCartView(db, await readCartIdent(), choice);
  if (!view || view.items.length === 0) redirect("/cart");
  const { pricing, items } = view;
  const needsAddress = items.some((i) => i.product.type === "PHYSICAL");
  const defaultAddress = user ? await db.address.findFirst({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }) : null;
  const shipping = Object.fromEntries(Object.entries(view.shippingByVendor).filter(([, m]) => m).map(([v, m]) => [v, m!.id]));
  const storeName = (vendorId: string) => items.find((i) => i.product.vendorId === vendorId)?.product.vendor.store?.name ?? "Seller";

  return (
    <div className="container-x py-10">
      <h1 className="text-2xl font-semibold">Checkout</h1>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
        <div>
          <CheckoutForm
            needsAddress={needsAddress}
            guest={!user}
            shipping={shipping}
            defaults={defaultAddress}
            totalLabel={formatMoney(pricing.totalMinor)}
            sandbox={(process.env.PAYMENT_PROVIDER ?? "sandbox") === "sandbox"}
          />
        </div>
        <aside className="h-fit rounded-lg border border-line lg:sticky lg:top-6">
          <h2 className="border-b border-line px-5 py-4 font-semibold">Your order · {pricing.vendors.length} {pricing.vendors.length === 1 ? "seller" : "sellers"}</h2>
          <form action="/checkout" className="divide-y divide-line">
            {pricing.vendors.map((v) => (
              <div key={v.vendorId} className="space-y-2 px-5 py-4 text-sm">
                <p className="font-medium">{storeName(v.vendorId)}</p>
                {v.lines.map((l) => {
                  const it = items.find((i) => i.id === l.key)!;
                  return <div key={l.key} className="tabular flex justify-between gap-3 text-ink-2"><span className="line-clamp-1">{l.quantity} × {it.product.name}</span><span>{formatMoney(l.lineTotalMinor)}</span></div>;
                })}
                {v.lines.some((l) => l.kind === "PHYSICAL") && (view.shippingOptions[v.vendorId]?.length ?? 0) > 0 && (
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <label htmlFor={`ship_${v.vendorId}`} className="text-ink-muted">Delivery</label>
                    <AutoSubmitSelect id={`ship_${v.vendorId}`} name={`ship_${v.vendorId}`} defaultValue={shipping[v.vendorId]} className="h-8 max-w-[210px] text-[13px]">
                      {view.shippingOptions[v.vendorId].map((m) => <option key={m.id} value={m.id}>{m.name} ({m.etaDaysMin}–{m.etaDaysMax} days)</option>)}
                    </AutoSubmitSelect>
                  </div>
                )}
                {v.shippingMinor > 0n && <div className="tabular flex justify-between text-ink-muted"><span>Delivery fee</span><span>{formatMoney(v.shippingMinor)}</span></div>}
              </div>
            ))}
          </form>
          <dl className="tabular space-y-2 border-t border-line px-5 py-4 text-sm">
            <div className="flex justify-between"><dt className="text-ink-muted">Items</dt><dd>{formatMoney(pricing.subtotalMinor)}</dd></div>
            {pricing.discountMinor > 0n && <div className="flex justify-between text-success"><dt>Discount</dt><dd>−{formatMoney(pricing.discountMinor)}</dd></div>}
            <div className="flex justify-between"><dt className="text-ink-muted">Delivery</dt><dd>{formatMoney(pricing.shippingMinor)}</dd></div>
            {pricing.taxMinor > 0n && <div className="flex justify-between"><dt className="text-ink-muted">VAT</dt><dd>{formatMoney(pricing.taxMinor)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-3 text-base font-semibold"><dt>Total</dt><dd>{formatMoney(pricing.totalMinor)}</dd></div>
          </dl>
          {view.issues.map((m) => <Alert key={m} tone="warning" className="m-4">{m}</Alert>)}
        </aside>
      </div>
    </div>
  );
}
