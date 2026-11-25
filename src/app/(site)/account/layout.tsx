import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { SideNav } from "@/components/layout/side-nav";
import { logoutAction } from "@/app/actions/auth";
import { unreadCounts } from "@/server/services/messaging";

export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/account");
  const [unread, messages] = await Promise.all([db.notification.count({ where: { userId: user.id, readAt: null } }), unreadCounts(user)]);
  return (
    <div className="container-x py-8 lg:py-10">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
        <aside className="min-w-0 space-y-6">
          <div className="hidden lg:block"><p className="font-medium">{user.name}</p><p className="truncate text-[13px] text-ink-muted">{user.email}</p></div>
          <SideNav
            title="My account"
            items={[
              { href: "/account", label: "Overview" },
              { href: "/account/orders", label: "Orders" },
              { href: "/account/messages", label: "Messages", badge: messages.customer },
              { href: "/account/bookings", label: "Bookings" },
              { href: "/account/downloads", label: "Downloads" },
              { href: "/account/wishlist", label: "Wishlist" },
              { href: "/account/addresses", label: "Addresses" },
              { href: "/account/notifications", label: "Notifications", badge: unread },
              { href: "/account/support", label: "Support" },
              { href: "/account/settings", label: "Settings" },
            ]}
          />
          <form action={logoutAction} className="hidden lg:block"><button className="px-3 text-sm text-ink-muted hover:text-ink">Sign out</button></form>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
