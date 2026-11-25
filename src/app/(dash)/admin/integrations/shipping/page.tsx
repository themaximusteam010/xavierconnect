import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { SHIPPING_ADAPTERS } from "@/server/integrations/registry";
import { ProviderCard } from "@/components/admin/provider-card";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery } from "@/components/ui/feedback";

export const metadata = { title: "Shipping providers" };

export default async function ShippingProviders({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const u = await guard("integrations.view");
  const sp = await searchParams;
  const canManage = u.permissions.has("integrations.manage");
  const [rows, stats] = await Promise.all([
    db.integrationProvider.findMany({ where: { kind: "SHIPPING" } }),
    db.shipment.groupBy({ by: ["providerKey", "status"], _count: true }),
  ]);
  return (
    <>
      <PageHeader eyebrow="Integrations" title="Shipping providers" description="Carriers and aggregators for rates, labels and tracking. Vendors can always use their own delivery instead." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="space-y-4">
        {SHIPPING_ADAPTERS.map((a) => {
          const s = stats.filter((x) => x.providerKey === a.key);
          const extra = s.length ? <p><span className="text-ink-muted">Shipments: </span>{s.map((x) => `${x._count} ${x.status.toLowerCase().replace(/_/g, " ")}`).join(" · ")}</p> : null;
          return <ProviderCard key={a.key} adapter={a} row={rows.find((r) => r.key === a.key) ?? null} back="/admin/integrations/shipping" canManage={canManage} extra={extra} />;
        })}
      </div>
    </>
  );
}
