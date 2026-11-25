"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface NavItem { href: string; label: string; badge?: number }

export function SideNav({ items, title }: { items: NavItem[]; title?: string }) {
  const path = usePathname();
  const active = (href: string) => (href === items[0]?.href ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <nav aria-label={title ?? "Section"}>
      {title && <p className="eyebrow mb-3 hidden lg:block">{title}</p>}
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:px-0 lg:pb-0">
        {items.map((i) => (
          <li key={i.href} className="shrink-0">
            <Link href={i.href} aria-current={active(i.href) ? "page" : undefined} className={cn("flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm", active(i.href) ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:bg-sunken hover:text-ink")}>
              {i.label}
              {!!i.badge && <span className="tabular rounded-full bg-brand px-1.5 text-2xs font-semibold text-white">{i.badge}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
