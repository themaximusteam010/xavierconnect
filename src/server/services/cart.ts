import { methodServes } from "@/lib/countries";
import { quoteKey, resolveCheckoutQuote } from "./shipping-rates";
import type { DbClient } from "@/server/db";
import { priceOrder, type CouponInput, type PricingLine, type ShippingMethodInput } from "@/server/domain/pricing";
import type { CommissionRuleInput } from "@/server/domain/commission";
import { getSetting } from "./settings";

export interface CartIdent {
  userId?: string | null;
  guestToken?: string | null;
}

export class CartError extends Error {}

export async function findCart(db: DbClient, ident: CartIdent) {
  if (ident.userId) return db.cart.findUnique({ where: { userId: ident.userId } });
  if (ident.guestToken) return db.cart.findUnique({ where: { guestToken: ident.guestToken } });
  return null;
}

export async function getOrCreateCart(db: DbClient, ident: CartIdent) {
  const existing = await findCart(db, ident);
  if (existing) return existing;
  if (ident.userId) return db.cart.create({ data: { userId: ident.userId } });
  if (ident.guestToken) return db.cart.create({ data: { guestToken: ident.guestToken } });
  throw new CartError("No cart identity");
}

async function purchasable(db: DbClient, productId: string, variantKey: string) {
  const p = await db.product.findFirst({
    where: { id: productId, status: "PUBLISHED", deletedAt: null, vendor: { status: "APPROVED" } },
    include: { variants: true },
  });
  if (!p) throw new CartError("This product is no longer available.");
  const variant = variantKey ? p.variants.find((v) => v.id === variantKey) : null;
  if (variantKey && !variant) throw new CartError("Please choose an available option.");
  if (!variantKey && p.variants.length) throw new CartError("Please choose an option first.");
  const stock = variant ? variant.stockQuantity : p.stockQuantity;
  return { product: p, variant, stock: p.type === "DIGITAL" || !p.trackInventory ? Infinity : stock };
}

export async function addToCart(db: DbClient, ident: CartIdent, productId: string, quantity: number, variantKey = "") {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new CartError("Invalid quantity.");
  const { product, stock } = await purchasable(db, productId, variantKey);
  const cart = await getOrCreateCart(db, ident);
  const current = await db.cartItem.findUnique({
    where: { cartId_productId_variantKey: { cartId: cart.id, productId, variantKey } },
  });
  const next = product.type === "DIGITAL" ? 1 : (current?.quantity ?? 0) + quantity;
  if (next > stock) throw new CartError(stock <= 0 ? "Out of stock." : `Only ${stock} left in stock.`);
  await db.cartItem.upsert({
    where: { cartId_productId_variantKey: { cartId: cart.id, productId, variantKey } },
    update: { quantity: next },
    create: { cartId: cart.id, productId, variantKey, quantity: next },
  });
  return cart;
}

export async function setCartQuantity(db: DbClient, ident: CartIdent, itemId: string, quantity: number) {
  const cart = await findCart(db, ident);
  const item = cart && (await db.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } }));
  if (!item) throw new CartError("Item not found in your cart.");
  if (quantity <= 0) return db.cartItem.delete({ where: { id: item.id } });
  const { stock } = await purchasable(db, item.productId, item.variantKey);
  if (quantity > stock) throw new CartError(`Only ${stock} left in stock.`);
  return db.cartItem.update({ where: { id: item.id }, data: { quantity: Math.min(quantity, 99) } });
}

/** Called after login: move guest items into the user's cart. */
export async function mergeGuestCart(db: DbClient, guestToken: string, userId: string) {
  const guest = await db.cart.findUnique({ where: { guestToken }, include: { items: true } });
  if (!guest) return;
  const userCart = await getOrCreateCart(db, { userId });
  for (const it of guest.items) {
    await db.cartItem.upsert({
      where: { cartId_productId_variantKey: { cartId: userCart.id, productId: it.productId, variantKey: it.variantKey } },
      update: { quantity: { increment: it.quantity } },
      create: { cartId: userCart.id, productId: it.productId, variantKey: it.variantKey, quantity: it.quantity },
    });
  }
  await db.cart.delete({ where: { id: guest.id } });
}

export async function loadCommissionRules(db: DbClient): Promise<CommissionRuleInput[]> {
  const rows = await db.commissionRule.findMany({ where: { active: true } });
  return rows.map((r) => ({ ...r, scope: r.scope }));
}

export async function categoryAncestors(db: DbClient, categoryId: string): Promise<string[]> {
  const out: string[] = [];
  let cur = await db.category.findUnique({ where: { id: categoryId }, select: { parentId: true } });
  while (cur?.parentId && out.length < 5) {
    out.push(cur.parentId);
    cur = await db.category.findUnique({ where: { id: cur.parentId }, select: { parentId: true } });
  }
  return out;
}

export async function resolveCoupon(db: DbClient, code: string | null | undefined): Promise<CouponInput | null> {
  if (!code) return null;
  const now = new Date();
  const c = await db.coupon.findFirst({
    where: {
      code: code.toUpperCase(),
      active: true,
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
    },
  });
  if (!c || (c.maxUses != null && c.usedCount >= c.maxUses)) return null;
  return { code: c.code, vendorId: c.vendorId, type: c.type, value: c.value, minSubtotalMinor: c.minSubtotalMinor, maxDiscountMinor: c.maxDiscountMinor };
}

/** Load a cart with everything needed to render and price it. */
export async function loadCartView(db: DbClient, ident: CartIdent, shippingChoice: Record<string, string> = {}, opts: { destination?: { line1: string; city: string; state: string; country?: string } | null } = {}) {
  const cart = await findCart(db, ident);
  if (!cart) return null;
  const items = await db.cartItem.findMany({
    where: { cartId: cart.id },
    orderBy: { createdAt: "asc" },
    include: {
      product: {
        include: {
          images: { orderBy: { sortOrder: "asc" }, take: 1 },
          variants: true,
          vendor: { include: { store: true, shippingMethods: { where: { active: true } }, subscription: { include: { plan: true } } } },
        },
      },
    },
  });

  const issues: string[] = [];
  const valid = items.filter((i) => {
    const ok = i.product.status === "PUBLISHED" && !i.product.deletedAt && i.product.vendor.status === "APPROVED";
    if (!ok) issues.push(`${i.product.name} is no longer available and was skipped.`);
    return ok;
  });

  const lines: PricingLine[] = [];
  for (const i of valid) {
    const variant = i.variantKey ? i.product.variants.find((v) => v.id === i.variantKey) : null;
    const base = variant?.priceMinor ?? i.product.priceMinor;
    const unit = !variant?.priceMinor && i.product.salePriceMinor != null && i.product.salePriceMinor < base ? i.product.salePriceMinor : base;
    lines.push({
      key: i.id,
      vendorId: i.product.vendorId,
      productId: i.productId,
      categoryId: i.product.categoryId,
      categoryAncestors: await categoryAncestors(db, i.product.categoryId),
      kind: i.product.type === "DIGITAL" ? "DIGITAL" : "PHYSICAL",
      unitPriceMinor: unit,
      quantity: i.quantity,
      weightGrams: i.product.weightGrams,
    });
  }

  const shippingByVendor: Record<string, ShippingMethodInput | null> = {};
  const shippingOptions: Record<string, { id: string; name: string; etaDaysMin: number; etaDaysMax: number }[]> = {};
  const vendorOrigin: Record<string, string> = {};
  const carrierQuotes: Record<string, { quoteId: string; costMinor: bigint; providerKey: string; courierName: string }> = {};
  const staleQuotes: string[] = [];
  const vendorPlans: Record<string, string | null> = {};
  for (const i of valid) {
    const v = i.product.vendor;
    if (shippingOptions[v.id]) continue;
    // Buyers are in Nigeria; only offer methods that actually deliver there.
    const usable = v.shippingMethods.filter((m) => methodServes(v.country, m, "NG"));
    vendorOrigin[v.id] = v.country;
    shippingOptions[v.id] = usable.map((m) => ({ id: m.id, name: m.name, etaDaysMin: m.etaDaysMin, etaDaysMax: m.etaDaysMax }));
    let chosen: ShippingMethodInput | null = usable.find((m) => m.id === shippingChoice[v.id]) ?? null;
    // Courier quote chosen at checkout ("q:<id>"): valid only for this cart, seller, destination and items.
    const pick = shippingChoice[v.id];
    if (!chosen && pick?.startsWith("q:")) {
      const vendorLines = valid.filter((i) => i.product.vendorId === v.id && i.product.type !== "DIGITAL").map((i) => ({ productId: i.productId, quantity: i.quantity }));
      const key = opts.destination ? quoteKey(opts.destination, vendorLines) : null;
      const q = await resolveCheckoutQuote(pick, cart.id, v.id, key);
      if (q) {
        chosen = { id: `q:${q.id}`, type: "FLAT", rateMinor: q.amountMinor, perKgMinor: 0n, freeOverMinor: null };
        carrierQuotes[v.id] = { quoteId: q.id, costMinor: q.costMinor ?? q.amountMinor, providerKey: q.providerKey, courierName: q.courierName };
      } else if (opts.destination) staleQuotes.push(v.id);
    }
    chosen = chosen ?? usable[0] ?? null;
    shippingByVendor[v.id] = chosen;
    vendorPlans[v.id] = v.subscription?.status === "ACTIVE" ? v.subscription.plan.key : null;
  }

  const coupon = await resolveCoupon(db, cart.couponCode);
  const pricing = priceOrder({
    lines,
    rules: await loadCommissionRules(db),
    shippingByVendor,
    coupon,
    vendorPlans,
    taxBps: await getSetting(db, "taxBps"),
  });
  return { cart, items: valid, pricing, shippingByVendor, shippingOptions, vendorOrigin, carrierQuotes, staleQuotes, issues, couponCode: cart.couponCode, couponValid: !!coupon };
}

export type CartView = NonNullable<Awaited<ReturnType<typeof loadCartView>>>;
