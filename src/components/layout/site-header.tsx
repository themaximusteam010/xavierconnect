import Link from "next/link";
import { Heart, Menu, ShoppingBag, Store, User } from "lucide-react";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { readCartIdent } from "@/server/cart-ident";
import { Logo } from "@/components/brand/logo";
import { SearchBox } from "./search-box";

async function cartCount() {
  const ident = await readCartIdent();
  if (!ident.userId && !ident.guestToken) return 0;
  const agg = await db.cartItem.aggregate({
    where: { cart: ident.userId ? { userId: ident.userId } : { guestToken: ident.guestToken! } },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? 0;
}

const NAV = [
  { href: "/shop", label: "Shop all" },
  { href: "/services", label: "Services" },
  { href: "/shop?type=digital", label: "Digital" },
  { href: "/deals", label: "Deals" },
  { href: "/stores", label: "Stores" },
];

export async function SiteHeader() {
  const [user, count, cats] = await Promise.all([
    getCurrentUser(),
    cartCount(),
    db.category.findMany({ where: { parentId: null, kind: "PRODUCT" }, orderBy: { sortOrder: "asc" }, take: 7, select: { slug: true, name: true } }),
  ]);
  const accountHref = user ? (user.isStaff ? "/admin" : "/account") : "/login";

  return (
    <header className="border-b border-line bg-white">
      <div className="bg-ink text-[12px] text-white/85">
        <div className="container-x flex h-8 items-center justify-between">
          <p className="truncate">Buy from independent Nigerian businesses.<span className="hidden sm:inline"> Pay once, every seller is paid separately.</span></p>
          <div className="hidden gap-5 sm:flex">
            <Link href="/help" className="hover:text-white">Help Centre</Link>
            <Link href="/sell" className="hover:text-white">Sell on XavierConnect</Link>
          </div>
        </div>
      </div>

      <div className="container-x flex h-[68px] items-center gap-4 lg:gap-8">
        <details className="relative lg:hidden">
          <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md hover:bg-sunken" aria-label="Menu"><Menu className="size-5" /></summary>
          <nav className="absolute left-0 top-12 z-50 w-64 rounded-md border border-line bg-white py-2 shadow-pop">
            {NAV.map((n) => <Link key={n.href} href={n.href} className="block px-4 py-2.5 text-sm hover:bg-sunken">{n.label}</Link>)}
            <div className="my-2 border-t border-line" />
            {cats.map((c) => <Link key={c.slug} href={`/shop?category=${c.slug}`} className="block px-4 py-2 text-sm text-ink-2 hover:bg-sunken">{c.name}</Link>)}
            <div className="my-2 border-t border-line" />
            <Link href="/sell" className="block px-4 py-2.5 text-sm font-medium text-brand">Become a vendor</Link>
          </nav>
        </details>
        <Logo />
        <SearchBox className="hidden flex-1 md:block" />
        <nav className="ml-auto flex items-center gap-1 md:ml-0" aria-label="Account">
          {user?.vendorIds.length ? (
            <Link href="/vendor" className="hidden h-10 items-center gap-2 rounded-md px-3 text-sm text-ink-2 hover:bg-sunken lg:flex"><Store className="size-[18px]" />My store</Link>
          ) : null}
          <Link href={accountHref} className="flex h-10 items-center gap-2 rounded-md px-3 text-sm text-ink-2 hover:bg-sunken">
            <User className="size-[18px]" />
            <span className="hidden max-w-28 truncate lg:inline">{user ? user.name.split(" ")[0] : "Sign in"}</span>
          </Link>
          <Link href="/account/wishlist" className="hidden size-10 items-center justify-center rounded-md text-ink-2 hover:bg-sunken sm:flex" aria-label="Wishlist"><Heart className="size-[18px]" /></Link>
          <Link href="/cart" className="relative flex size-10 items-center justify-center rounded-md text-ink-2 hover:bg-sunken" aria-label={`Cart, ${count} items`}>
            <ShoppingBag className="size-[18px]" />
            {count > 0 && <span className="tabular absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">{count > 99 ? "99+" : count}</span>}
          </Link>
        </nav>
      </div>
      <div className="container-x pb-3 md:hidden"><SearchBox /></div>

      <nav className="hidden border-t border-line lg:block" aria-label="Categories">
        <div className="container-x flex h-11 items-center gap-6 text-[13px]">
          {NAV.map((n) => <Link key={n.href} href={n.href} className="font-medium text-ink hover:text-brand">{n.label}</Link>)}
          <span className="h-4 w-px bg-line" />
          {cats.map((c) => <Link key={c.slug} href={`/shop?category=${c.slug}`} className="text-ink-2 hover:text-brand">{c.name}</Link>)}
        </div>
      </nav>
    </header>
  );
}
