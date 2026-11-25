import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { resolveRange, dayBuckets } from "@/components/admin/date-range";
import { FilterBar } from "@/components/admin/filters";
import { BarChart, HBars, Kpi, Panel } from "@/components/admin/charts";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";

export const metadata = { title: "Communication" };

/** Aggregate statistics only. No message content is shown or queried here. */
export default async function Communication({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await guard("messages.moderate");
  const sp = await searchParams;
  const r = resolveRange(sp);
  const inRange = { gte: r.from, lt: r.to };
  const [convTotal, convNew, delivered, blocked, held, attBlocked, attReview, reports, mutes, flags, cats, perDay, decisions] = await Promise.all([
    db.conversation.count(),
    db.conversation.count({ where: { createdAt: inRange } }),
    db.message.count({ where: { status: "DELIVERED", createdAt: inRange } }),
    db.message.count({ where: { status: "BLOCKED", createdAt: inRange } }),
    db.message.count({ where: { status: "HELD" } }),
    db.messageAttachment.count({ where: { status: "BLOCKED", createdAt: inRange } }),
    db.messageAttachment.count({ where: { status: "REVIEW" } }),
    db.messageReport.count({ where: { status: "OPEN" } }),
    db.userMessagingRestriction.count({ where: { kind: "MUTE", liftedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } }),
    db.userMessagingRestriction.count({ where: { kind: "REVIEW_FLAG", liftedAt: null } }),
    db.$queryRaw<{ c: string; n: bigint }[]>`SELECT unnest(categories) c, COUNT(*)::bigint n FROM "ModerationEvent" WHERE "createdAt" >= ${r.from} AND "createdAt" < ${r.to} AND decision IN ('BLOCKED','ATTACHMENT_BLOCKED','REVIEW') AND source = 'AUTO' GROUP BY 1 ORDER BY n DESC`,
    db.$queryRaw<{ d: Date; n: bigint }[]>`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'Africa/Lagos') d, COUNT(*)::bigint n FROM "ModerationEvent" WHERE "createdAt" >= ${r.from} AND "createdAt" < ${r.to} AND decision IN ('BLOCKED','ATTACHMENT_BLOCKED') GROUP BY 1`,
    db.moderationEvent.groupBy({ by: ["decision", "source"], where: { createdAt: inRange }, _count: true }),
  ]);
  const rate = delivered + blocked ? ((blocked / (delivered + blocked)) * 100).toFixed(1) : "0.0";
  return (
    <>
      <PageHeader title="Communication" description={`${r.label} · aggregate messaging activity. Message content is never shown here.`} actions={<ButtonLink href="/admin/communication/moderation">Moderation centre</ButtonLink>} />
      <FilterBar action="/admin/communication" values={sp} fields={[{ type: "range" }]} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Conversations" value={convTotal.toLocaleString()} sub={`${convNew} new in period`} />
        <Kpi label="Messages delivered" value={delivered.toLocaleString()} />
        <Kpi label="Messages blocked" value={blocked.toLocaleString()} sub={`${rate}% of attempts`} tone={blocked ? "warning" : undefined} />
        <Kpi label="Attachments blocked" value={attBlocked} />
        <Kpi label="Awaiting review" value={held + attReview} sub={<Link href="/admin/communication/moderation" className="text-brand">{held} messages · {attReview} files</Link>} tone={held + attReview ? "warning" : undefined} />
        <Kpi label="Open reports" value={reports} tone={reports ? "danger" : undefined} sub={<Link href="/admin/communication/moderation?tab=reports" className="text-brand">Review</Link>} />
        <Kpi label="Users restricted" value={mutes} sub={`${flags} flagged for review`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Blocked messages and files per day"><BarChart label="Blocked per day" data={dayBuckets(r).map((b) => ({ label: b.label, value: Number(perDay.find((x) => x.d.toISOString().slice(0, 10) === b.key)?.n ?? 0n) }))} /></Panel>
        <Panel title="What the automatic checks found"><HBars data={cats.map((c) => ({ label: c.c.toLowerCase().replace(/_/g, " "), value: Number(c.n) }))} empty="Nothing flagged in this period." /></Panel>
        <Panel title="Decisions"><HBars data={decisions.map((d) => ({ label: `${d.decision.toLowerCase().replace(/_/g, " ")} (${d.source.toLowerCase()})`, value: d._count }))} empty="No decisions in this period." /></Panel>
        <Alert title="Privacy">Staff can read a message only when the automatic checks held or blocked it, or when a participant reports the conversation. Every view and decision is recorded in the audit log. See docs/MESSAGING_POLICY.md.</Alert>
      </div>
    </>
  );
}
