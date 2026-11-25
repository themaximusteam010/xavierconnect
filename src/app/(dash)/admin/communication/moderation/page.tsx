import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { reportedTranscript, RULE_KINDS, ModerationError } from "@/server/services/moderation-admin";
import { getSetting } from "@/server/services/settings";
import { attachmentDecisionAction, heldDecisionAction, liftRestrictionAction, resolveReportAction, restrictUserAction, saveRuleAction, toggleRuleAction } from "@/app/actions/moderation";
import { PageHeader } from "@/components/ui/page-header";
import { Alert, Badge, FlashFromQuery } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { qs } from "@/components/admin/filters";

export const metadata = { title: "Message moderation" };
type SP = { tab?: string; id?: string; user?: string; decision?: string; ok?: string; error?: string };
const TABS: [string, string][] = [["review", "Review queue"], ["reports", "Reported conversations"], ["attachments", "Attachments"], ["users", "Repeat violations & restrictions"], ["rules", "Rules & enforcement"], ["audit", "Moderation log"]];
const dt = (d: Date) => d.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" });
const cats = (c: string[]) => c.map((x) => <Badge key={x} tone="warning" className="mr-1">{x.toLowerCase().replace(/_/g, " ")}</Badge>);

export default async function Moderation({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await guard("messages.moderate");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "review";
  const counts = await Promise.all([
    db.message.count({ where: { status: "HELD" } }), db.messageReport.count({ where: { status: "OPEN" } }), db.messageAttachment.count({ where: { status: "REVIEW" } }),
    db.userMessagingRestriction.count({ where: { kind: "REVIEW_FLAG", liftedAt: null } }),
  ]);
  const badge: Record<string, number> = { review: counts[0], reports: counts[1], attachments: counts[2], users: counts[3] };
  return (
    <>
      <PageHeader title="Message moderation" description="You see only content the automatic checks held or blocked, files awaiting review, and conversations a participant reported. Every view and decision is logged." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line text-sm">{TABS.map(([k, l]) => <Link key={k} href={`/admin/communication/moderation?tab=${k}`} className={`-mb-px shrink-0 border-b-2 px-3 py-2 ${tab === k ? "border-ink font-medium" : "border-transparent text-ink-muted hover:text-ink"}`}>{l}{badge[k] ? <span className="ml-1.5 rounded-full bg-brand px-1.5 text-[11px] text-white">{badge[k]}</span> : null}</Link>)}</nav>
      {tab === "review" && <ReviewTab />}
      {tab === "reports" && <ReportsTab sp={sp} actorId={u.id} />}
      {tab === "attachments" && <AttachmentsTab />}
      {tab === "users" && <UsersTab sp={sp} />}
      {tab === "rules" && <RulesTab />}
      {tab === "audit" && <AuditTab sp={sp} />}
    </>
  );
}

async function ReviewTab() {
  const held = await db.message.findMany({
    where: { status: "HELD" }, orderBy: { createdAt: "asc" }, take: 50,
    include: { sender: { select: { name: true, email: true } }, conversation: { select: { subject: true, vendor: { select: { businessName: true } }, customer: { select: { name: true } } } }, moderationEvents: { where: { source: "AUTO" }, select: { categories: true, detail: true } } },
  });
  if (!held.length) return <p className="rounded-lg border border-line bg-white p-8 text-center text-sm text-ink-muted">Nothing waiting. Held messages appear here when a check is unsure.</p>;
  return (
    <ul className="space-y-3">
      {held.map((m) => (
        <li key={m.id} className="rounded-lg border border-line bg-white p-4 text-[13px]">
          <p className="mb-1 text-ink-muted">{dt(m.createdAt)} · from <span className="font-medium text-ink">{m.sender.name}</span> ({m.senderSide.toLowerCase()}) · {m.conversation.customer.name} ↔ {m.conversation.vendor.businessName} · “{m.conversation.subject}”</p>
          <p className="mb-2">{cats(m.moderationEvents.flatMap((e) => e.categories))}</p>
          <blockquote className="whitespace-pre-wrap rounded-md bg-canvas p-3 text-[14px]">{m.body}</blockquote>
          <form action={heldDecisionAction} className="mt-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={m.id} />
            <Input name="note" placeholder="Note (optional)" className="h-8 w-64" />
            <SubmitButton name="decision" value="approve" size="sm">Deliver</SubmitButton>
            <SubmitButton name="decision" value="reject" size="sm" variant="secondary">Don&apos;t deliver</SubmitButton>
            <Checkbox name="violation" label="Count as a violation" />
          </form>
        </li>
      ))}
    </ul>
  );
}

async function ReportsTab({ sp, actorId }: { sp: SP; actorId: string }) {
  const reports = await db.messageReport.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 100, include: { reporter: { select: { name: true } }, conversation: { select: { id: true, subject: true, customer: { select: { name: true } }, vendor: { select: { businessName: true } } } } } });
  const sel = sp.id ? reports.find((r) => r.id === sp.id) : null;
  let transcript: Awaited<ReturnType<typeof reportedTranscript>> | null = null;
  let err: string | null = null;
  if (sel) { try { transcript = await reportedTranscript(actorId, sel.conversationId); } catch (e) { if (e instanceof ModerationError) err = e.message; else throw e; } }
  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <ul className="space-y-2">
        {reports.length === 0 && <li className="rounded-lg border border-line bg-white p-6 text-center text-sm text-ink-muted">No open reports.</li>}
        {reports.map((r) => (
          <li key={r.id}><Link href={qs("/admin/communication/moderation", { tab: "reports", id: r.id })} className={`block rounded-lg border bg-white p-3 text-[13px] ${sel?.id === r.id ? "border-brand" : "border-line hover:border-ink"}`}>
            <p className="font-medium">{r.reason}</p>
            <p className="text-ink-muted">{r.conversation.customer.name} ↔ {r.conversation.vendor.businessName} · reported by {r.reporter.name} · {dt(r.createdAt)}</p>
            {r.details && <p className="mt-1 line-clamp-2">{r.details}</p>}
          </Link></li>
        ))}
      </ul>
      <div>
        {!sel && <p className="text-sm text-ink-muted">Select a report. Opening it shows that conversation&apos;s transcript and records your access in the audit log.</p>}
        {err && <Alert tone="danger">{err}</Alert>}
        {sel && transcript && (
          <div className="space-y-4">
            <Alert>Viewing because of report “{sel.reason}”. This access has been logged.</Alert>
            <ol className="max-h-[60vh] space-y-2 overflow-y-auto rounded-lg border border-line bg-white p-4 text-[13px]">
              {transcript.messages.map((m) => (
                <li key={m.id} className={`rounded-md p-2.5 ${m.senderSide === "VENDOR" ? "ml-8 bg-brand-soft/40" : "mr-8 bg-canvas"} ${m.status !== "DELIVERED" ? "border border-dashed border-amber-300" : ""}`}>
                  <p className="text-[11px] text-ink-muted">{m.sender.name} ({m.senderSide.toLowerCase()}) · {dt(m.createdAt)}{m.status !== "DELIVERED" && <> · <span className="font-medium text-warning">{m.status.toLowerCase()} — not seen by recipient</span></>}</p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  {m.attachments.map((a) => <p key={a.id} className="text-[12px] text-ink-muted">📎 {a.fileName} ({a.status.toLowerCase()})</p>)}
                </li>
              ))}
            </ol>
            <div className="grid gap-4 lg:grid-cols-2">
              <form action={resolveReportAction} className="space-y-2 rounded-lg border border-line bg-white p-4 text-[13px]">
                <input type="hidden" name="id" value={sel.id} />
                <p className="font-medium">Close report</p>
                <Textarea name="resolution" rows={3} required minLength={5} placeholder="What you found and did" />
                <div className="flex gap-2"><SubmitButton name="status" value="RESOLVED" size="sm">Resolved</SubmitButton><SubmitButton name="status" value="DISMISSED" size="sm" variant="secondary">Dismiss</SubmitButton></div>
              </form>
              <div className="space-y-2 rounded-lg border border-line bg-white p-4 text-[13px]">
                <p className="font-medium">Restrict a participant</p>
                {[{ id: transcript.customer.id, name: transcript.customer.name }, { id: transcript.vendor.ownerId, name: `${transcript.vendor.businessName} (owner)` }].map((p) => (
                  <form key={p.id} action={restrictUserAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="userId" value={p.id} />
                    <span className="w-40 truncate">{p.name}</span>
                    <Select name="hours" className="h-8 w-28"><option value="24">24 hours</option><option value="168">7 days</option><option value="0">Until lifted</option></Select>
                    <Input name="reason" required placeholder="Reason" className="h-8 w-36" />
                    <SubmitButton size="sm" variant="secondary">Restrict</SubmitButton>
                  </form>
                ))}
                <p className="text-[12px] text-ink-muted">Account suspension is a separate decision on the user&apos;s page (requires user management permission).</p>
                <p className="text-[12px]"><Link className="text-brand" href={`/admin/users/${transcript.customer.id}`}>Customer account</Link> · <Link className="text-brand" href={`/admin/vendors/${transcript.vendor.id}`}>Vendor</Link></p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

async function AttachmentsTab() {
  const files = await db.messageAttachment.findMany({ where: { OR: [{ status: "REVIEW" }, { status: "BLOCKED", createdAt: { gte: new Date(Date.now() - 14 * 864e5) } }] }, orderBy: [{ status: "desc" }, { createdAt: "asc" }], take: 100, include: { message: { select: { status: true, sender: { select: { name: true } } } } } });
  return (
    <Table>
      <thead><tr><Th>File</Th><Th>From</Th><Th>Checks</Th><Th>Findings</Th><Th>Status</Th><Th>Decision</Th></tr></thead>
      <tbody>
        {files.length === 0 && <tr><Td colSpan={6} className="py-8 text-center text-ink-muted">No flagged attachments.</Td></tr>}
        {files.map((a) => (
          <tr key={a.id}>
            <Td>{a.storageKey ? <a href={`/admin-files/message-attachment/${a.id}`} target="_blank" rel="noopener" className="text-brand underline">{a.fileName}</a> : <span>{a.fileName} <span className="text-ink-muted">(not kept)</span></span>}<span className="block text-[11px] text-ink-muted">{a.mimeType} · {(a.size / 1024).toFixed(0)} KB · {dt(a.createdAt)}</span></Td>
            <Td>{a.message.sender.name}</Td>
            <Td className="text-[12px]">{a.scanner ?? "—"}</Td>
            <Td>{cats(((a.findings as { category: string }[] | null) ?? []).map((f) => f.category))}</Td>
            <Td><Badge tone={a.status === "BLOCKED" ? "danger" : "warning"}>{a.status.toLowerCase()}</Badge></Td>
            <Td>{a.status === "REVIEW" && (
              <form action={attachmentDecisionAction} className="flex flex-wrap items-center gap-1.5">
                <input type="hidden" name="id" value={a.id} />
                <SubmitButton name="decision" value="approve" size="sm" disabled={a.message.status !== "DELIVERED"}>Release</SubmitButton>
                <SubmitButton name="decision" value="block" size="sm" variant="secondary">Block</SubmitButton>
                <Checkbox name="violation" label="Violation" />
              </form>
            )}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

async function UsersTab({ sp }: { sp: SP }) {
  const days = await getSetting(db, "msgViolationWindowDays");
  const since = new Date(Date.now() - days * 864e5);
  const top = await db.moderationEvent.groupBy({ by: ["userId"], where: { confirmed: true, createdAt: { gte: since }, ...(sp.user ? { userId: sp.user } : {}) }, _count: true, orderBy: { _count: { userId: "desc" } }, take: 50 });
  const [users, restrictions] = await Promise.all([
    db.user.findMany({ where: { id: { in: top.map((t) => t.userId) } }, select: { id: true, name: true, email: true, status: true } }),
    db.userMessagingRestriction.findMany({ where: { liftedAt: null, kind: { in: ["MUTE", "REVIEW_FLAG"] }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { name: true, email: true } } } }),
  ]);
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 font-semibold">Active restrictions and review flags</h2>
        <Table>
          <thead><tr><Th>User</Th><Th>Type</Th><Th>Reason</Th><Th>Until</Th><Th>Set by</Th><Th /></tr></thead>
          <tbody>
            {restrictions.length === 0 && <tr><Td colSpan={6} className="py-6 text-center text-ink-muted">None.</Td></tr>}
            {restrictions.map((r) => (
              <tr key={r.id}><Td><Link href={`/admin/users/${r.userId}`} className="hover:text-brand">{r.user.name}</Link><span className="block text-[11px] text-ink-muted">{r.user.email}</span></Td><Td><Badge tone={r.kind === "MUTE" ? "danger" : "warning"}>{r.kind === "MUTE" ? "messaging paused" : "needs review"}</Badge></Td><Td>{r.reason}</Td><Td>{r.endsAt ? dt(r.endsAt) : r.kind === "MUTE" ? "until lifted" : "—"}</Td><Td>{r.createdById ? "moderator" : "automatic"}</Td>
                <Td><form action={liftRestrictionAction}><input type="hidden" name="id" value={r.id} /><SubmitButton size="sm" variant="ghost">{r.kind === "MUTE" ? "Lift" : "Mark reviewed"}</SubmitButton></form></Td></tr>
            ))}
          </tbody>
        </Table>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Confirmed violations, last {days} days</h2>
        <Table>
          <thead><tr><Th>User</Th><Th className="text-right">Violations</Th><Th>Account</Th><Th>Restrict messaging</Th></tr></thead>
          <tbody>
            {top.length === 0 && <tr><Td colSpan={4} className="py-6 text-center text-ink-muted">No confirmed violations.</Td></tr>}
            {top.map((t) => { const usr = users.find((x) => x.id === t.userId); return (
              <tr key={t.userId}><Td><Link href={`/admin/users/${t.userId}`} className="hover:text-brand">{usr?.name}</Link><span className="block text-[11px] text-ink-muted">{usr?.email}</span></Td><Td className="tabular text-right">{t._count}</Td><Td>{usr?.status.toLowerCase()}</Td>
                <Td><form action={restrictUserAction} className="flex flex-wrap items-center gap-1.5"><input type="hidden" name="userId" value={t.userId} /><Select name="hours" className="h-8 w-28"><option value="24">24 hours</option><option value="168">7 days</option><option value="0">Until lifted</option></Select><Input name="reason" required placeholder="Reason" className="h-8 w-40" /><SubmitButton size="sm" variant="secondary">Restrict</SubmitButton></form></Td></tr>
            ); })}
          </tbody>
        </Table>
        <p className="mt-2 text-[12px] text-ink-muted">Suspending an account is done from the user&apos;s page and is never automatic.</p>
      </section>
    </div>
  );
}

async function RulesTab() {
  const [rules, settings] = await Promise.all([
    db.moderationRule.findMany({ orderBy: [{ kind: "asc" }, { value: "asc" }] }),
    Promise.all((["msgViolationWindowDays", "msgRestrictAfter", "msgRestrictHours", "msgReviewAfter", "msgBlockedRetentionDays"] as const).map((k) => getSetting(db, k))),
  ]);
  const [win, after, hours, review, retention] = settings;
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <div className="rounded-lg border border-line bg-white p-4 text-[13px]">
          <p className="mb-2 font-semibold">Progressive enforcement (confirmed violations within {win} days)</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>First violation: warning shown to the sender.</li>
            <li>{after} or more: messaging paused for {hours} hours.</li>
            <li>{review} or more: account flagged for moderator review.</li>
            <li>Suspension: only by an authorised administrator.</li>
          </ol>
          <p className="mt-2 text-ink-muted">Blocked text and flagged files are purged after {retention} days. <Link href="/admin/settings" className="text-brand underline">Change thresholds</Link></p>
        </div>
        <Table>
          <thead><tr><Th>Rule</Th><Th>Value</Th><Th>Note</Th><Th>State</Th><Th /></tr></thead>
          <tbody>
            {rules.length === 0 && <tr><Td colSpan={5} className="py-6 text-center text-ink-muted">No custom rules. The built-in detectors are always on unless switched off here.</Td></tr>}
            {rules.map((r) => <tr key={r.id}><Td>{RULE_KINDS[r.kind as keyof typeof RULE_KINDS] ?? r.kind}</Td><Td className="font-mono text-[12px]">{r.value}</Td><Td>{r.note}</Td><Td><Badge tone={r.enabled ? "success" : "neutral"}>{r.enabled ? "on" : "off"}</Badge></Td><Td><form action={toggleRuleAction}><input type="hidden" name="id" value={r.id} /><SubmitButton size="sm" variant="ghost">{r.enabled ? "Turn off" : "Turn on"}</SubmitButton></form></Td></tr>)}
          </tbody>
        </Table>
      </div>
      <form action={saveRuleAction} className="h-fit space-y-3 rounded-lg border border-line bg-white p-4 text-[13px]">
        <p className="font-semibold">Add a rule</p>
        <label className="block">Type<Select name="kind">{Object.entries(RULE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></label>
        <label className="block">Value<Input name="value" required placeholder="e.g. dm for price · nigeriapost.gov.ng · PHONE" /></label>
        <label className="block">Note<Input name="note" /></label>
        <SubmitButton size="sm">Save rule</SubmitButton>
        <p className="text-[12px] text-ink-muted">Detectors that can be switched off: EMAIL, PHONE, URL, MESSAGING_HANDLE, OFF_PLATFORM_PAYMENT. Switching one off is logged.</p>
      </form>
    </div>
  );
}

async function AuditTab({ sp }: { sp: SP }) {
  const [events, logs] = await Promise.all([
    db.moderationEvent.findMany({ where: sp.decision ? { decision: sp.decision as never } : {}, orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { name: true } } } }),
    db.auditLog.findMany({ where: { OR: [{ action: { startsWith: "moderation." } }, { action: { startsWith: "conversation." } }] }, orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { name: true } } } }),
  ]);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section>
        <h2 className="mb-2 font-semibold">Moderation decisions</h2>
        <div className="mb-2 flex gap-1 text-[12px]">{["", "BLOCKED", "REVIEW", "ATTACHMENT_BLOCKED", "APPROVED"].map((d) => <Link key={d} href={qs("/admin/communication/moderation", { tab: "audit", decision: d })} className={`rounded-full px-2.5 py-1 ${(sp.decision ?? "") === d ? "bg-ink text-white" : "border border-line"}`}>{d ? d.toLowerCase().replace("_", " ") : "all"}</Link>)}</div>
        <Table>
          <thead><tr><Th>When</Th><Th>User</Th><Th>Decision</Th><Th>Found</Th><Th>By</Th></tr></thead>
          <tbody>{events.map((e) => <tr key={e.id}><Td className="whitespace-nowrap">{dt(e.createdAt)}</Td><Td>{e.user.name}</Td><Td>{e.decision.toLowerCase().replace("_", " ")}{e.confirmed && <Badge tone="danger" className="ml-1">violation</Badge>}</Td><Td>{cats(e.categories)}</Td><Td>{e.source === "AUTO" ? "automatic" : "moderator"}</Td></tr>)}</tbody>
        </Table>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Staff actions and user reports</h2>
        <Table>
          <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Target</Th></tr></thead>
          <tbody>{logs.map((l) => <tr key={l.id}><Td className="whitespace-nowrap">{dt(l.createdAt)}</Td><Td>{l.actor?.name ?? "system"}</Td><Td className="font-mono text-[12px]">{l.action}</Td><Td className="text-[12px]">{l.entityType}</Td></tr>)}</tbody>
        </Table>
      </section>
    </div>
  );
}
