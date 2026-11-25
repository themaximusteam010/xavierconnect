import { saveProviderAction, testProviderAction } from "@/app/actions/admin-ops";
import type { AdapterMeta } from "@/server/integrations/types";
import type { IntegrationProvider } from "@prisma/client";
import { Badge } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

const STATUS_LABEL = { AVAILABLE: ["Integrated", "success"], SANDBOX_SIMULATOR: ["Sandbox simulator", "warning"], AWAITING_PARTNERSHIP: ["Awaiting partnership", "warning"], NOT_IMPLEMENTED: ["Not integrated", "neutral"] } as const;

export function ProviderCard({ adapter, row, back, canManage, extra }: { adapter: AdapterMeta<string>; row: IntegrationProvider | null; back: string; canManage: boolean; extra?: React.ReactNode }) {
  const [label, tone] = STATUS_LABEL[adapter.status];
  const appUrl = process.env.APP_URL ?? "";
  return (
    <section className="rounded-lg border border-line bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2"><h3 className="font-semibold">{adapter.name}</h3><Badge tone={tone}>{label}</Badge>{row?.active ? <Badge tone="success">Active · {row.mode.toLowerCase()}</Badge> : <Badge>Inactive</Badge>}</div>
        {row?.lastCheckAt && <span className={`text-[12px] ${row.lastCheckOk ? "text-success" : "text-danger"}`}>Last test {row.lastCheckAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}: {row.lastCheckOk ? "OK" : "failed"}</span>}
      </header>
      <div className="grid gap-5 p-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3 text-[13px]">
          <p className="leading-6 text-ink-2">{adapter.notes}</p>
          <p><span className="text-ink-muted">Capabilities: </span>{adapter.capabilities.length ? adapter.capabilities.map((c) => <Badge key={c} className="mr-1">{c.toLowerCase().replace(/_/g, " ")}</Badge>) : <span className="text-ink-muted">none — cannot be activated</span>}</p>
          {"routes" in adapter && Array.isArray((adapter as { routes?: string[] }).routes) && <p><span className="text-ink-muted">Routes: </span>{(adapter as unknown as { routes: string[] }).routes.join(", ").replace(/>/g, "→") || "—"}</p>}
          {adapter.capabilities.includes("WEBHOOKS" as never) && <p><span className="text-ink-muted">Webhook URL: </span><code className="select-all break-all">{appUrl}/api/webhooks/{adapter.key}</code></p>}
          {adapter.docsUrl && <p><a href={adapter.docsUrl} target="_blank" rel="noopener noreferrer" className="text-brand underline">Official documentation</a></p>}
          {row?.lastCheckMessage && <p className="text-ink-muted">Last test: {row.lastCheckMessage}</p>}
          {extra}
        </div>
        {canManage ? (
          <form action={saveProviderAction} className="space-y-2.5 rounded-md bg-canvas p-3 text-[13px]">
            <input type="hidden" name="key" value={adapter.key} /><input type="hidden" name="back" value={back} />
            <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={row?.active} disabled={adapter.capabilities.length === 0} className="size-4 accent-[var(--color-brand)]" />Active</label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1"><span className="text-ink-muted">Mode</span><Select name="mode" defaultValue={row?.mode ?? "SANDBOX"} className="h-8 text-[13px]"><option value="SANDBOX">Sandbox</option><option value="LIVE" disabled={adapter.status === "SANDBOX_SIMULATOR"}>Production</option></Select></label>
              <label className="space-y-1"><span className="text-ink-muted">Partner approval</span><Select name="approval" defaultValue={row?.approval ?? "NOT_STARTED"} className="h-8 text-[13px]"><option value="NOT_REQUIRED">Not required</option><option value="NOT_STARTED">Not started</option><option value="APPLIED">Applied</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></Select></label>
            </div>
            <label className="block space-y-1"><span className="text-ink-muted">Countries (ISO, comma-separated)</span><Input name="countries" defaultValue={row?.countries.join(", ")} className="h-8 text-[13px]" /></label>
            <label className="block space-y-1"><span className="text-ink-muted">Currencies</span><Input name="currencies" defaultValue={row?.currencies.join(", ")} className="h-8 text-[13px]" /></label>
            {adapter.kind === "PAYMENT" && <label className="block space-y-1"><span className="text-ink-muted">Methods</span><Input name="methods" defaultValue={row?.methods.join(", ")} placeholder="card, bank_transfer" className="h-8 text-[13px]" /></label>}
            {adapter.credentialFields.map((f) => (
              <label key={f.name} className="block space-y-1"><span className="text-ink-muted">{f.label}{f.secret && row?.credentialHint ? ` (saved ${row.credentialHint})` : ""}</span><Input name={`cred_${f.name}`} type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.secret ? (row?.credentialsEnc ? "Leave blank to keep" : "Not set") : ""} className="h-8 text-[13px]" /></label>
            ))}
            <label className="block space-y-1"><span className="text-ink-muted">Internal notes</span><Textarea name="notes" defaultValue={row?.notes ?? ""} rows={2} className="text-[13px]" /></label>
            <SubmitButton size="sm" className="w-full">Save</SubmitButton>
          </form>
        ) : <p className="text-[13px] text-ink-muted">You can view provider status. Changes need the integrations.manage permission.</p>}
      </div>
      {canManage && "testConnection" in adapter && (adapter as { testConnection?: unknown }).testConnection ? (
        <form action={testProviderAction} className="border-t border-line px-4 py-2.5"><input type="hidden" name="key" value={adapter.key} /><input type="hidden" name="back" value={back} /><SubmitButton size="sm" variant="secondary">Test connection</SubmitButton></form>
      ) : null}
    </section>
  );
}
