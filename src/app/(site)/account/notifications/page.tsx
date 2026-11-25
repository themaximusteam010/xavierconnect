import Link from "next/link";
import { Bell } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { markNotificationsReadAction } from "@/app/actions/account";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Notifications" };

export default async function Notifications() {
  const u = await requireUser("/account/notifications");
  const list = await db.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <PageHeader title="Notifications" actions={list.some((n) => !n.readAt) && <form action={markNotificationsReadAction}><Button type="submit" variant="secondary" size="sm">Mark all as read</Button></form>} />
      {list.length === 0 ? <EmptyState icon={Bell} title="You're all caught up" /> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {list.map((n) => (
            <li key={n.id} className={`px-4 py-3 text-sm ${n.readAt ? "" : "bg-brand-soft/50"}`}>
              <div className="flex justify-between gap-4"><p className="font-medium">{n.title}</p><span className="shrink-0 text-[12px] text-ink-muted">{n.createdAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</span></div>
              <p className="mt-0.5 text-ink-2">{n.body}</p>
              {n.link && <Link href={n.link} className="mt-1 inline-block text-[13px] text-brand hover:underline">View</Link>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
