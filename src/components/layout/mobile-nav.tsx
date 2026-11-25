import Link from "next/link";
import { Home, LayoutGrid, ShoppingBag, User, Wrench } from "lucide-react";

export function MobileBottomNav() {
  const items = [
    { href: "/", label: "Home", Icon: Home },
    { href: "/shop", label: "Shop", Icon: LayoutGrid },
    { href: "/services", label: "Services", Icon: Wrench },
    { href: "/cart", label: "Cart", Icon: ShoppingBag },
    { href: "/account", label: "Account", Icon: User },
  ];
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="grid grid-cols-5">
        {items.map(({ href, label, Icon }) => (
          <li key={href}><Link href={href} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-ink-2"><Icon className="size-5" />{label}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
