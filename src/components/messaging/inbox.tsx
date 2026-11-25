import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquare, Search } from "lucide-react";
import { db } from "@/server/db";
import type { CurrentUser } from "@/server/auth/session";
import { authorize, listConversations, loadMessages, activeMute, MessagingError, REPORT_REASONS, type Side } from "@/server/services/messaging";
import { formatMoney } from "@/lib/money";
import { ChatPanel } from "./chat-panel";

const ago = (iso: string) => {
  const d = new Date(iso), now = Date.now(), s = (now - d.getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
  if (s < 6 * 864e2) return d.toLocaleDateString("en-NG", { weekday: "short" });
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short" });
};

export async function Inbox({ user, side, base, conversationId, sp }: { user: CurrentUser; side: Side; base: string; conversationId?: string; sp: { q?: string; archived?: string; product?: string; order?: string } }) {
  const archived = sp.archived === "1";
  const list = await listConversations(user, side, { q: sp.q, archived });
  let chat: React.ReactNode = null;
  if (conversationId) {
    let auth;
    try { auth = await authorize(user, conversationId, side); } catch (e) { if (e instanceof MessagingError) notFound(); throw e; }
    if (auth.side !== side) notFound();
    const { conv } = auth;
    const [messages, me, others, mute] = await Promise.all([
      loadMessages(user, conv.id, side),
      db.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: conv.id, userId: user.id } } }),
      db.conversationParticipant.findMany({ where: { conversationId: conv.id, side: side === "CUSTOMER" ? "VENDOR" : "CUSTOMER" }, include: { user: { select: { lastSeenAt: true } } } }),
      activeMute(user.id),
    ]);
    // Context card: product, service or order the thread is about.
    let context = null;
    if (conv.productId) {
      const p = await db.product.findUnique({ where: { id: conv.productId }, select: { name: true, slug: true, priceMinor: true, salePriceMinor: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } } });
      if (p) context = { kind: "product" as const, label: p.name, sub: formatMoney(p.salePriceMinor ?? p.priceMinor), href: `/p/${p.slug}`, image: p.images[0]?.url ?? null };
    } else if (conv.serviceId) {
      const s = await db.service.findUnique({ where: { id: conv.serviceId }, select: { title: true, slug: true } });
      if (s) context = { kind: "service" as const, label: s.title, sub: "Service", href: `/services/${s.slug}` };
    } else if (conv.orderId) {
      const o = await db.order.findUnique({ where: { id: conv.orderId }, select: { number: true, vendorOrders: { where: { vendorId: conv.vendorId }, select: { id: true, status: true } } } });
      if (o) context = { kind: "order" as const, label: `Order ${o.number}`, sub: o.vendorOrders[0]?.status.toLowerCase().replace(/_/g, " "), href: side === "CUSTOMER" ? `/account/orders/${o.number}` : `/vendor/orders/${o.vendorOrders[0]?.id}` };
    }
    // Pending reference from the entry point (e.g. "Message seller" on a product page).
    let pendingRef: { productId?: string; orderId?: string; label: string } | null = null;
    if (sp.product) {
      const p = await db.product.findFirst({ where: { id: sp.product, vendorId: conv.vendorId }, select: { id: true, name: true } });
      if (p) pendingRef = { productId: p.id, label: p.name };
    } else if (sp.order) {
      const o = await db.order.findFirst({ where: { id: sp.order, userId: conv.customerId }, select: { id: true, number: true } });
      if (o) pendingRef = { orderId: o.id, label: `Order ${o.number}` };
    }
    const now = Date.now();
    const subtitle = side === "CUSTOMER"
      ? conv.vendor.status === "APPROVED" ? "Seller on XavierConnect" : "This store is no longer active"
      : `Customer · ${await db.vendorOrder.count({ where: { vendorId: conv.vendorId, order: { userId: conv.customerId }, status: { notIn: ["AWAITING_PAYMENT", "CANCELLED"] } } })} orders with you`;
    chat = (
      <ChatPanel
        key={conv.id}
        conversationId={conv.id} side={side}
        title={side === "CUSTOMER" ? (conv.vendor.store?.name ?? conv.vendor.businessName) : conv.customer.name}
        titleHref={side === "CUSTOMER" && conv.vendor.store ? `/store/${conv.vendor.store.slug}` : undefined}
        subtitle={subtitle} backHref={`${base}${archived ? "?archived=1" : ""}`}
        initialMessages={messages}
        initialOnline={others.some((o) => o.user.lastSeenAt && now - o.user.lastSeenAt.getTime() < 60_000)}
        initialBlocked={{ byMe: !!(side === "CUSTOMER" ? conv.blockedByCustomerAt : conv.blockedByVendorAt), byThem: !!(side === "CUSTOMER" ? conv.blockedByVendorAt : conv.blockedByCustomerAt) }}
        archived={!!me?.archivedAt}
        context={context} pendingRef={pendingRef} reportReasons={REPORT_REASONS}
        restriction={mute ? (mute.endsAt ? `Your messaging is paused until ${mute.endsAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}.` : "Your messaging has been paused by our moderation team.") : null}
      />
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className={`${conversationId ? "hidden lg:flex" : "flex"} h-[calc(100dvh-8.5rem)] min-h-[480px] flex-col rounded-lg border border-line bg-white lg:h-[calc(100dvh-11rem)]`} aria-label="Conversations">
        <div className="border-b border-line p-3">
          <form action={base} className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            {archived && <input type="hidden" name="archived" value="1" />}
            <input name="q" defaultValue={sp.q} placeholder="Search messages" aria-label="Search conversations" className="h-9 w-full rounded-md border border-line-strong bg-canvas pl-9 pr-3 text-[13px] focus:border-brand focus:bg-white focus:outline-none" />
          </form>
          <div className="mt-2 flex gap-1 text-[12px]">
            <Link href={base} className={`rounded-full px-2.5 py-1 ${!archived ? "bg-ink text-white" : "text-ink-muted hover:bg-sunken"}`}>Inbox</Link>
            <Link href={`${base}?archived=1`} className={`rounded-full px-2.5 py-1 ${archived ? "bg-ink text-white" : "text-ink-muted hover:bg-sunken"}`}>Archived</Link>
          </div>
        </div>
        <ul className="flex-1 divide-y divide-line overflow-y-auto">
          {list.length === 0 && (
            <li className="p-6 text-center text-[13px] text-ink-muted">
              <MessageSquare className="mx-auto mb-2 size-6" />
              {sp.q ? "No conversations match your search." : archived ? "No archived conversations." : side === "CUSTOMER" ? "No messages yet. Use “Message seller” on a product, store or order." : "No messages yet. Buyers can message you from your products, store and orders."}
            </li>
          )}
          {list.map((c) => {
            const active = c.id === conversationId;
            return (
              <li key={c.id}>
                <Link href={`${base}/${c.id}${archived ? "?archived=1" : ""}`} className={`flex gap-3 px-3 py-3 ${active ? "bg-brand-soft/50" : "hover:bg-canvas"}`} aria-current={active ? "page" : undefined}>
                  {c.avatar ? <img src={c.avatar} alt="" className="size-10 shrink-0 rounded-full object-cover" /> : <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken text-[14px] font-semibold text-ink-2">{c.title.slice(0, 1).toUpperCase()}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-[14px] ${c.unread ? "font-semibold" : "font-medium"}`}>{c.title}</span>
                      {c.last && <span className={`shrink-0 text-[11px] ${c.unread ? "font-semibold text-brand" : "text-ink-muted"}`}>{ago(c.last.at)}</span>}
                    </span>
                    <span className="block truncate text-[12px] text-ink-muted">{c.subject}</span>
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-[13px] ${c.unread ? "text-ink" : "text-ink-muted"}`}>{c.blocked ? "Blocked" : c.last ? `${c.last.mine ? "You: " : ""}${c.last.body}` : "No messages yet"}</span>
                      {c.unread > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white" aria-label={`${c.unread} unread`}>{c.unread}</span>}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className={conversationId ? "" : "hidden lg:block"}>
        {chat ?? (
          <div className="grid h-[calc(100dvh-11rem)] min-h-[480px] place-items-center rounded-lg border border-dashed border-line-strong bg-white text-center text-[13px] text-ink-muted">
            <div><MessageSquare className="mx-auto mb-2 size-7" /><p className="font-medium text-ink">Select a conversation</p><p className="mt-1 max-w-xs">Keep conversations and payments on XavierConnect — it&apos;s how we protect both buyers and sellers.</p></div>
          </div>
        )}
      </div>
    </div>
  );
}
