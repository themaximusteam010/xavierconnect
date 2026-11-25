import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { replayWebhookAction, resolveAlertAction } from "@/app/actions/admin-ops";
import { PAYMENT_ADAPTERS, SHIPPING_ADAPTERS } from "@/server/integrations/registry";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { SubmitButton } from "@/components/ui/submit-button";
import { Kpi } from "@/components/admin/charts";
import { cn } from "@/lib/cn";

export const metadata = { title: "Integrations" };

export default async function Integrations({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; error?: string }> }) {
  const u = await guard("integrations.view");
  const sp = await searchParams;
  const tab = sp.tab ?? "alerts";
  const since = new Date(Date.now() - 864e5);
  const [providers, alerts, events, logs, errors24, dead] = await Promise.all([
    db.integrationProvider.findMany(),
    db.adminAlert.findMany({ where: tab === "alerts" ? { resolvedAt: null } : {}, orderBy: [{ resolvedAt: "asc" }, { lastSeenAt: "desc" }], take: 100 }),
    tab === "webhooks" ? db.paymentEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }) : [],
    tab === "logs" ? db.integrationLog.findMany({ orderBy: { createdAt: "desc" }, take: 150 }) : [],
    db.integrationLog.count({ where: { status: "ERROR", createdAt: { gte: since } } }),
    db.paymentEvent.count({ where: { deadLetteredAt: { not: null }, processedAt: null } }),
  ]);
  const active = providers.filter((p) => p.active);
  const tabs = [["alerts", "Alerts"], ["webhooks", "Webhook log"], ["logs", "Provider API log"]];
  return (
    <>
      <PageHeader title="Integrations" description="Payment and shipping providers, webhooks, API health and operational alerts." actions={<><Link href="/admin/integrations/payments" className="h-10 rounded-md border border-line-strong bg-white px-4 text-sm font-medium leading-10 hover:bg-sunken">Payment providers</Link><Link href="/admin/integrations/shipping" className="h-10 rounded-md border border-line-strong bg-white px-4 text-sm font-medium leading-10 hover:bg-sunken">Shipping providers</Link></>} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Active providers" value={active.length} sub={active.map((p) => p.name).join(", ") || "None"} />
        <Kpi label="Registered adapters" value={PAYMENT_ADAPTERS.length + SHIPPING_ADAPTERS.length} sub={`${[...PAYMENT_ADAPTERS, ...SHIPPING_ADAPTERS].filter((a) => a.status === "AVAILABLE").length} integrated · ${[...PAYMENT_ADAPTERS, ...SHIPPING_ADAPTERS].filter((a) => a.status === "AWAITING_PARTNERSHIP").length} awaiting partnership`} />
        <Kpi label="API errors (24h)" value={errors24} tone={errors24 ? "warning" : undefined} />
        <Kpi label="Dead-lettered webhooks" value={dead} tone={dead ? "danger" : undefined} />
      </div>
      <nav className="mb-4 flex gap-1 border-b border-line text-sm">{tabs.map(([k, l]) => <Link key={k} href={`/admin/integrations?tab=${k}`} className={cn("-mb-px border-b-2 px-3 py-2", tab === k ? "border-ink font-medium" : "border-transparent text-ink-muted hover:text-ink")}>{l}</Link>)}</nav>

      {tab === "alerts" && (alerts.length === 0 ? <p className="rounded-lg border border-dashed border-line-strong p-8 text-center text-sm text-ink-muted">No open alerts. Monitoring runs with the scheduled job.</p> : (
        <Table>
          <thead><tr><Th>Severity</Th><Th>Alert</Th><Th>Type</Th><Th>Seen</Th><Th>Last</Th><Th /></tr></thead>
          <tbody>{alerts.map((a) => (
            <tr key={a.id}>
              <Td><Badge tone={a.severity === "CRITICAL" ? "danger" : a.severity === "WARNING" ? "warning" : "info"}>{a.severity.toLowerCase()}</Badge></Td>
              <Td>{a.link ? <Link href={a.link} className="font-medium text-ink hover:text-brand">{a.title}</Link> : a.title}{a.detail && <span className="block max-w-xl text-[12px] text-ink-muted">{a.detail}</span>}</Td>
              <Td className="text-[12px]">{a.type.toLowerCase().replace(/_/g, " ")}</Td>
              <Td className="tabular">{a.count}×</Td>
              <Td className="whitespace-nowrap">{a.lastSeenAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</Td>
              <Td>{!a.resolvedAt && <form action={resolveAlertAction}><input type="hidden" name="key" value={a.dedupeKey} /><input type="hidden" name="back" value="/admin/integrations" /><SubmitButton size="sm" variant="ghost">Resolve</SubmitButton></form>}</Td>
            </tr>
          ))}</tbody>
        </Table>
      ))}

      {tab === "webhooks" && (
        <Table>
          <thead><tr><Th>Received</Th><Th>Provider</Th><Th>Kind</Th><Th>Event</Th><Th>Status</Th><Th>Attempts</Th><Th>Error</Th><Th /></tr></thead>
          <tbody>
            {events.length === 0 && <tr><Td colSpan={8} className="py-8 text-center text-ink-muted">No webhooks received yet.</Td></tr>}
            {events.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap">{e.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "medium" })}</Td>
                <Td>{e.provider}</Td><Td>{e.kind.toLowerCase()}</Td><Td className="font-mono text-[11px]">{e.type}</Td>
                <Td>{e.processedAt ? <StatusBadge status="COMPLETED" /> : e.deadLetteredAt ? <Badge tone="danger">dead-lettered</Badge> : <Badge tone="warning">retrying</Badge>}</Td>
                <Td className="tabular">{e.attempts}</Td>
                <Td className="max-w-xs truncate text-[12px] text-danger" title={e.error ?? ""}>{e.error}</Td>
                <Td>{e.deadLetteredAt && !e.processedAt && u.permissions.has("integrations.manage") && <form action={replayWebhookAction}><input type="hidden" name="id" value={e.id} /><SubmitButton size="sm" variant="secondary">Replay</SubmitButton></form>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {tab === "logs" && (
        <Table>
          <thead><tr><Th>Time</Th><Th>Provider</Th><Th>Operation</Th><Th>Result</Th><Th>HTTP</Th><Th className="text-right">ms</Th><Th>Reference</Th><Th>Message</Th></tr></thead>
          <tbody>
            {logs.length === 0 && <tr><Td colSpan={8} className="py-8 text-center text-ink-muted">No outbound provider calls yet.</Td></tr>}
            {logs.map((l) => <tr key={l.id}><Td className="whitespace-nowrap">{l.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "medium" })}</Td><Td>{l.providerKey}</Td><Td className="font-mono text-[11px]">{l.operation}</Td><Td>{l.status === "OK" ? <StatusBadge status="COMPLETED" /> : <StatusBadge status="FAILED" />}</Td><Td className="tabular">{l.httpStatus ?? "—"}</Td><Td className="tabular text-right">{l.durationMs}</Td><Td className="font-mono text-[11px]">{l.reference}</Td><Td className="max-w-xs truncate text-[12px]" title={l.message ?? ""}>{l.message}</Td></tr>)}
          </tbody>
        </Table>
      )}
    </>
  );
}
