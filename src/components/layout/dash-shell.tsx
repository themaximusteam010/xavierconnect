import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { SideNav, type NavItem } from "./side-nav";
import { logoutAction } from "@/app/actions/auth";

export function DashShell({ title, subtitle, nav, children, viewHref }: { title: string; subtitle?: string; nav: NavItem[]; children: React.ReactNode; viewHref?: string }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-white">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
          <Link href="/" aria-label="XavierConnect home"><LogoMark className="size-7" /></Link>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold">{title}</p>
            {subtitle && <p className="truncate text-[12px] text-ink-muted">{subtitle}</p>}
          </div>
          <div className="ml-auto flex items-center gap-1">
            {viewHref && <Link href={viewHref} className="hidden h-8 items-center gap-1.5 rounded-md px-3 text-[13px] text-ink-2 hover:bg-sunken sm:flex"><ExternalLink className="size-3.5" />View store</Link>}
            <Link href="/account" className="h-8 rounded-md px-3 text-[13px] leading-8 text-ink-2 hover:bg-sunken">My account</Link>
            <form action={logoutAction}><button className="h-8 rounded-md px-3 text-[13px] text-ink-muted hover:bg-sunken">Sign out</button></form>
          </div>
        </div>
      </header>
      <div className="lg:grid lg:grid-cols-[220px_1fr]">
        <aside className="border-b border-line bg-white px-4 py-3 lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:border-b-0 lg:border-r lg:py-6">
          <SideNav items={nav} />
        </aside>
        <main id="main" className="min-w-0 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
