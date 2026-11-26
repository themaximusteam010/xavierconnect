import { countryName } from "@/lib/countries";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { readCartIdent } from "@/server/cart-ident";
import { loadCartView } from "@/server/services/cart";
import { checkoutCarrierOptions, type CheckoutLine } from "@/server/services/shipping-rates";
import { NIGERIAN_STATES } from "@/lib/validation";
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
  const ident = await readCartIdent();
  const base = await loadCartView(db, ident, {});
  if (!base || base.items.length === 0) redirect("/cart");
  const needsAddress = base.items.some((i) => i.product.type === "PHYSICAL");
  const savedAddress = user ? await db.address.findFirst({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }) : null;
  // Delivery location used for courier quotes: from the form below, else the customer's saved address.
  const urlDest = sp.d_line1 && sp.d_city && sp.d_state ? { fullName: sp.d_name ?? "", phone: sp.d_phone ?? "", line1: sp.d_line1, city: sp.d_city, state: sp.d_state, country: "NG" } : null;
  const dest = urlDest ?? (savedAddress ? { fullName: savedAddress.fullName, phone: savedAddress.phone, line1: savedAddress.line1, city: savedAddress.city, state: savedAddress.state, country: "NG" } : null);
  const carrierActive = needsAddress && (await db.integrationProvider.count({ where: { kind: "SHIPPING", active: true } })) > 0;
  let carrier: Awaited<ReturnType<typeof checkoutCarrierOptions>> = {};
  if (carrierActive && dest && dest.phone) {
    const lines: Record<string, CheckoutLine[]> = {};
    for (const i of base.items.filter((x) => x.product.type === "PHYSICAL")) {
      (lines[i.product.vendorId] ??= []).push({ productId: i.productId, quantity: i.quantity, name: i.product.name, unitPriceMinor: i.product.salePriceMinor ?? i.product.priceMinor, weightGrams: i.product.weightGrams, lengthCm: i.product.lengthCm, widthCm: i.product.widthCm, heightCm: i.product.heightCm });
    }
    carrier = await checkoutCarrierOptions(base.cart.id, { ...dest, email: user?.email }, lines);
  }
  // Preselect the recommended courier option when the customer hasn't chosen yet.
  for (const [vendorId, c] of Object.entries(carrier)) if (!choice[vendorId]) { const rec = c.options.find((o) => o.recommended); if (rec) choice[vendorId] = rec.id; }
  const view = (await loadCartView(db, ident, choice, { destination: dest }))!;
  const { pricing, items } = view;
  const defaultAddress = urlDest ? { line2: null, ...(savedAddress ?? {}), ...urlDest } : savedAddress;
  const keep = Object.fromEntries(Object.entries(sp).filter(([k]) => k.startsWith("d_")));
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
            {Object.entries(keep).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
            {pricing.vendors.map((v) => (
              <div key={v.vendorId} className="space-y-2 px-5 py-4 text-sm">
                <p className="font-medium">{storeName(v.vendorId)}</p>
                {v.lines.map((l) => {
                  const it = items.find((i) => i.id === l.key)!;
                  return <div key={l.key} className="tabular flex justify-between gap-3 text-ink-2"><span className="line-clamp-1">{l.quantity} × {it.product.name}</span><span>{formatMoney(l.lineTotalMinor)}</span></div>;
                })}
                {v.lines.some((l) => l.kind === "PHYSICAL") && ((view.shippingOptions[v.vendorId]?.length ?? 0) > 0 || (carrier[v.vendorId]?.options.length ?? 0) > 0) && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor={`ship_${v.vendorId}`} className="text-ink-muted">Delivery</label>
                      <AutoSubmitSelect id={`ship_${v.vendorId}`} name={`ship_${v.vendorId}`} defaultValue={shipping[v.vendorId]} className="h-8 max-w-[230px] text-[13px]">
                        {(carrier[v.vendorId]?.options.length ?? 0) > 0 && (
                          <optgroup label="Courier (live price)">
                            {carrier[v.vendorId].options.map((o) => <option key={o.id} value={o.id}>{o.recommended ? "★ " : ""}{o.courierName} · {formatMoney(o.amountMinor)}{o.etaText ? ` · ${o.etaText}` : ""}</option>)}
                          </optgroup>
                        )}
                        {(view.shippingOptions[v.vendorId]?.length ?? 0) > 0 && (
                          <optgroup label="Seller's delivery (seller-set price)">
                            {view.shippingOptions[v.vendorId].map((m) => <option key={m.id} value={m.id}>{m.name} ({m.etaDaysMin}–{m.etaDaysMax} days)</option>)}
                          </optgroup>
                        )}
                      </AutoSubmitSelect>
                    </div>
                    {(() => {
                      const sel = carrier[v.vendorId]?.options.find((o) => o.id === shipping[v.vendorId]);
                      if (!sel) return <p className="text-[12px] text-ink-muted">Delivered by the seller at the price they set{view.shippingOptions[v.vendorId]?.length ? "" : ""}.</p>;
                      return <p className="text-[12px] text-ink-muted">{sel.providerName} · {sel.methodType?.toLowerCase().replace("_", " ") ?? "courier"}{sel.etaText ? ` · ${sel.etaText}` : ""} · {sel.trackingAvailable ? "tracked" : "no tracking"}{sel.restrictions ? ` · ${sel.restrictions}` : ""}</p>;
                    })()}
                  </div>
                )}
                {carrierActive && v.lines.some((l) => l.kind === "PHYSICAL") && !dest && <p className="text-[12px] text-ink-muted">Enter your delivery location below to see courier prices.</p>}
                {carrier[v.vendorId]?.note && <p className="text-[12px] text-ink-muted">{carrier[v.vendorId].note}</p>}
                {v.lines.some((l) => l.kind === "PHYSICAL") && view.vendorOrigin[v.vendorId] && view.vendorOrigin[v.vendorId] !== "NG" && <p className="rounded bg-warning-soft px-2 py-1 text-[12px] text-warning">Ships from {countryName(view.vendorOrigin[v.vendorId])}. Nigeria Customs import duties and taxes may be charged on arrival and are not included in this total unless the seller ships duties-paid.</p>}
                {v.lines.some((l) => l.kind === "PHYSICAL") && (view.shippingOptions[v.vendorId]?.length ?? 0) === 0 && <p className="text-[12px] text-danger">This seller has no delivery option to Nigeria for these items.</p>}
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
          {carrierActive && (
            <form action="/checkout" className="space-y-2 border-t border-line px-5 py-4 text-[13px]">
              <p className="font-medium">Delivery location for courier prices</p>
              {Object.entries(choice).map(([k, val]) => !val.startsWith("q:") && <input key={k} type="hidden" name={`ship_${k}`} value={val} />)}
              <input name="d_name" defaultValue={dest?.fullName ?? ""} placeholder="Recipient name" className="h-8 w-full rounded-md border border-line-strong px-2" required />
              <input name="d_phone" defaultValue={dest?.phone ?? ""} placeholder="Phone" className="h-8 w-full rounded-md border border-line-strong px-2" required />
              <input name="d_line1" defaultValue={dest?.line1 ?? ""} placeholder="Street address" className="h-8 w-full rounded-md border border-line-strong px-2" required />
              <div className="flex gap-2">
                <input name="d_city" defaultValue={dest?.city ?? ""} placeholder="City" className="h-8 w-1/2 rounded-md border border-line-strong px-2" required />
                <select name="d_state" defaultValue={dest?.state ?? ""} className="h-8 w-1/2 rounded-md border border-line-strong px-2" required><option value="">State</option>{NIGERIAN_STATES.map((st) => <option key={st}>{st}</option>)}</select>
              </div>
              <button className="h-8 w-full rounded-md border border-line-strong font-medium hover:bg-sunken">Get courier prices</button>
              <p className="text-[11px] text-ink-muted">Prices come live from the courier. Use the same address in the delivery form.</p>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
