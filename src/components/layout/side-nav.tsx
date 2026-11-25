"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface NavItem { href: string; label: string; badge?: number; group?: string }

export function SideNav({ items, title }: { items: NavItem[]; title?: string }) {
  const path = usePathname();
  const active = (href: string) => (href === items[0]?.href ? path === href : path === href || path.startsWith(`${href}/`));
  // Most specific match wins (e.g. /admin/integrations/payments over /admin/integrations).
  const best = items.filter((i) => active(i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label={title ?? "Section"}>
      {title && <p className="eyebrow mb-3 hidden lg:block">{title}</p>}
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:gap-0.5 lg:px-0 lg:pb-0">
        {items.map((i, idx) => (
          <li key={i.href} className="shrink-0">
            {i.group && i.group !== items[idx - 1]?.group && <p className="eyebrow mb-1 mt-4 hidden px-3 text-[10px] first:mt-0 lg:block">{i.group}</p>}
            <Link href={i.href} aria-current={best === i.href ? "page" : undefined} className={cn("flex items-center justify-between gap-3 rounded-md px-3 py-1.5 text-[13px]", best === i.href ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:bg-sunken hover:text-ink")}>
              {i.label}
              {!!i.badge && <span className="tabular rounded-full bg-brand px-1.5 text-2xs font-semibold text-white">{i.badge}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
