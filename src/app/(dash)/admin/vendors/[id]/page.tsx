import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { vendorBalances } from "@/server/domain/ledger";
import { reviewVendorAction, suspendVendorAction } from "@/app/actions/admin";
import { PageHeader, Stat } from "@/components/ui/page-header";
import { FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Textarea, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";
import { countryName } from "@/lib/countries";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/feedback";

export default async function VendorDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const u = await guard("vendor.view");
  const { id } = await params;
  const sp = await searchParams;
  const v = await db.vendor.findUnique({ where: { id }, include: { store: true, owner: true, documents: true, shippingMethods: true, payoutAccount: true, _count: { select: { products: true, vendorOrders: true } } } });
  if (!v) notFound();
  const tab = (await searchParams as { tab?: string }).tab ?? "overview";
  const [bal, logs, extra] = await Promise.all([
    u.permissions.has("finance.view") ? vendorBalances(db, id) : null,
    db.auditLog.findMany({ where: { entityType: "Vendor", entityId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { actor: { select: { name: true } } } }),
    loadTab(id, tab, u.permissions.has("finance.view")),
  ]);
  const tabs: [string, string][] = [["overview", "Overview"], ["products", "Listings"], ["orders", "Orders"], ...(u.permissions.has("finance.view") ? ([["finance", "Earnings & payouts"]] as [string, string][]) : []), ["shipping", "Shipping"], ["activity", "Activity"]];
  const canDecide = u.permissions.has("vendor.approve");
  const row = (k: string, val: React.ReactNode) => <div className="grid grid-cols-[160px_1fr] gap-3 px-4 py-2.5"><dt className="text-ink-muted">{k}</dt><dd>{val || "—"}</dd></div>;
  return (
    <>
      <PageHeader eyebrow="Vendor" title={v.store?.name ?? v.businessName} description={<span className="flex items-center gap-2"><StatusBadge status={v.status} /> {v.verificationLevel.replace(/_/g, " ").toLowerCase()} {v.store && v.status === "APPROVED" && <Link href={`/store/${v.store.slug}`} className="text-brand underline">View store</Link>}</span>} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      {bal && <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Pending" value={formatMoney(bal.pending)} /><Stat label="Available" value={formatMoney(bal.available)} /><Stat label="In withdrawal" value={formatMoney(bal.payoutHold)} /><Stat label="Orders / listings" value={`${v._count.vendorOrders} / ${v._count.products}`} /></div>}
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line text-sm">{tabs.map(([k, l]) => <Link key={k} href={`/admin/vendors/${id}?tab=${k}`} className={`-mb-px shrink-0 border-b-2 px-3 py-2 ${tab === k ? "border-ink font-medium" : "border-transparent text-ink-muted hover:text-ink"}`}>{l}</Link>)}</nav>
      {tab !== "overview" && extra}
      {tab === "overview" && <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-line bg-white"><h2 className="border-b border-line px-4 py-3 font-semibold">Application</h2>
            <dl className="divide-y divide-line text-sm">
              {row("Type", v.type.replace(/_/g, " ").toLowerCase())}{row("Business name", v.businessName)}{row("CAC number", v.rcNumber)}{row("Category", v.businessCategory)}
              {row("Description", <span className="whitespace-pre-line">{v.description}</span>)}{row("Owner", `${v.owner.name} · ${v.owner.email}${v.owner.emailVerifiedAt ? " (verified)" : " (unverified)"}`)}
              {row("Business contact", `${v.email} · ${v.phone}`)}{row("Address", [v.addressLine1, v.city, v.state ?? v.region].filter(Boolean).join(", "))}{row("Country", `${countryName(v.country)} · paid in ${v.payoutCurrency}${v.internationalShipping ? " · ships internationally" : ""}`)}{row("Website", v.website)}
              {row("Payout account", v.payoutAccount ? `${v.payoutAccount.bankName} ••••${v.payoutAccount.accountNumberLast4} · ${v.payoutAccount.accountName}` : null)}
              {row("Delivery options", v.shippingMethods.map((m) => m.name).join(", "))}
              {row("Agreement", v.agreementAcceptedAt ? `v${v.agreementVersion} accepted ${v.agreementAcceptedAt.toLocaleDateString("en-NG")}` : null)}
              {row("Submitted", v.submittedAt?.toLocaleString("en-NG"))}
            </dl>
          </section>
          <section className="rounded-lg border border-line bg-white"><h2 className="border-b border-line px-4 py-3 font-semibold">Documents</h2>
            {v.documents.length === 0 ? <p className="px-4 py-3 text-sm text-ink-muted">None uploaded.</p> : <ul className="divide-y divide-line text-sm">{v.documents.map((d) => <li key={d.id} className="flex items-center justify-between px-4 py-2.5"><a href={`/admin-docs/${d.id}`} target="_blank" className="text-brand underline">{d.type.replace(/_/g, " ").toLowerCase()} — {d.fileName}</a><StatusBadge status={d.status} /></li>)}</ul>}
            <p className="border-t border-line px-4 py-2 text-[12px] text-ink-muted">Document views are recorded in the audit log.</p>
          </section>
          <section className="rounded-lg border border-line bg-white"><h2 className="border-b border-line px-4 py-3 font-semibold">History</h2>
            <ul className="divide-y divide-line text-sm">{logs.length === 0 ? <li className="px-4 py-3 text-ink-muted">No decisions yet.</li> : logs.map((l) => <li key={l.id} className="px-4 py-2.5"><span className="font-medium">{l.action}</span> by {l.actor?.name ?? "system"} · {l.createdAt.toLocaleString("en-NG")}{(l.after as { note?: string; reason?: string } | null)?.note && <span className="block text-ink-muted">“{(l.after as { note: string }).note}”</span>}</li>)}</ul>
          </section>
        </div>
        {canDecide && (
          <aside className="space-y-6">
            {v.status === "SUBMITTED" && (
              <form action={reviewVendorAction} className="space-y-3 rounded-lg border border-line bg-white p-4">
                <h2 className="font-semibold">Decision</h2>
                <input type="hidden" name="id" value={v.id} />
                <Textarea name="note" rows={3} placeholder="Note to applicant (required for reject / changes)" />
                <SubmitButton name="decision" value="APPROVE" className="w-full" confirm="Approve this vendor? They will be able to list and sell immediately.">Approve</SubmitButton>
                <SubmitButton name="decision" value="REQUEST_CHANGES" variant="secondary" className="w-full">Request changes</SubmitButton>
                <SubmitButton name="decision" value="REJECT" variant="ghost" className="w-full text-danger">Reject</SubmitButton>
                <p className="text-[12px] text-ink-muted">Approval awards “{v.type === "BUSINESS" ? "Verified business" : "ID verified"}” only because documents were reviewed. Accept documents only after checking them.</p>
              </form>
            )}
            {(v.status === "APPROVED" || v.status === "SUSPENDED") && (
              <form action={suspendVendorAction} className="space-y-3 rounded-lg border border-line bg-white p-4">
                <h2 className="font-semibold">{v.status === "APPROVED" ? "Suspend vendor" : "Reinstate vendor"}</h2>
                <input type="hidden" name="id" value={v.id} /><input type="hidden" name="suspend" value={v.status === "APPROVED" ? "1" : "0"} />
                {v.status === "APPROVED" && <Input name="reason" placeholder="Reason (shown to vendor)" required />}
                <SubmitButton variant={v.status === "APPROVED" ? "danger" : "primary"} className="w-full" confirm={v.status === "APPROVED" ? "Suspend this vendor? All listings will be hidden." : undefined}>{v.status === "APPROVED" ? "Suspend" : "Reinstate"}</SubmitButton>
              </form>
            )}
          </aside>
        )}
      </div>}
    </>
  );
}

const d = (x: Date | null | undefined) => x?.toLocaleDateString("en-NG", { dateStyle: "medium" }) ?? "—";

async function loadTab(id: string, tab: string, finance: boolean) {
  if (tab === "products") {
    const [products, services] = await Promise.all([
      db.product.findMany({ where: { vendorId: id, deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 100 }),
      db.service.findMany({ where: { vendorId: id, deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 100 }),
    ]);
    return (
      <Table>
        <thead><tr><Th>Listing</Th><Th>Type</Th><Th className="text-right">Price</Th><Th className="text-right">Stock</Th><Th>Status</Th><Th>Updated</Th></tr></thead>
        <tbody>
          {products.map((p) => <tr key={p.id}><Td><a href={`/p/${p.slug}`} className="hover:text-brand">{p.name}</a></Td><Td>{p.type.toLowerCase()}</Td><Td className="tabular text-right">{formatMoney(p.salePriceMinor ?? p.priceMinor)}</Td><Td className="tabular text-right">{p.trackInventory ? p.stockQuantity : "∞"}</Td><Td><StatusBadge status={p.status} /></Td><Td>{d(p.updatedAt)}</Td></tr>)}
          {services.map((s) => <tr key={s.id}><Td><a href={`/services/${s.slug}`} className="hover:text-brand">{s.title}</a></Td><Td>service</Td><Td /><Td /><Td><StatusBadge status={s.status} /></Td><Td>{d(s.updatedAt)}</Td></tr>)}
          {products.length + services.length === 0 && <tr><Td colSpan={6} className="py-6 text-center text-ink-muted">No listings.</Td></tr>}
        </tbody>
      </Table>
    );
  }
  if (tab === "orders") {
    const orders = await db.vendorOrder.findMany({ where: { vendorId: id }, orderBy: { createdAt: "desc" }, take: 100, include: { order: { select: { number: true } }, disputes: { select: { status: true } } } });
    return (
      <Table>
        <thead><tr><Th>Sub-order</Th><Th>Placed</Th><Th>Status</Th><Th>Delivery evidence</Th><Th className="text-right">Total</Th><Th className="text-right">Commission</Th><Th>Settled</Th></tr></thead>
        <tbody>{orders.length === 0 ? <tr><Td colSpan={7} className="py-6 text-center text-ink-muted">No orders.</Td></tr> : orders.map((o) => <tr key={o.id}><Td><Link href={`/admin/orders/${o.order.number}`} className="hover:text-brand">{o.number}</Link>{o.disputes.some((x) => !["CLOSED", "RESOLVED_CUSTOMER", "RESOLVED_VENDOR"].includes(x.status)) && <Badge tone="danger" className="ml-1">dispute</Badge>}</Td><Td>{d(o.createdAt)}</Td><Td><StatusBadge status={o.status} /></Td><Td>{o.deliveryEvidence?.toLowerCase().replace(/_/g, " ") ?? "—"}</Td><Td className="tabular text-right">{formatMoney(o.totalMinor)}</Td><Td className="tabular text-right">{formatMoney(o.commissionMinor)}</Td><Td>{d(o.settledAt)}</Td></tr>)}</tbody>
      </Table>
    );
  }
  if (tab === "finance" && finance) {
    const [payouts, bens, rules, sub] = await Promise.all([
      db.payout.findMany({ where: { vendorId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
      db.beneficiary.findMany({ where: { vendorId: id }, orderBy: { createdAt: "desc" } }),
      db.commissionRule.findMany({ where: { vendorId: id, active: true } }),
      db.vendorSubscription.findUnique({ where: { vendorId: id }, include: { plan: true } }),
    ]);
    return (
      <div className="space-y-6">
        <section className="rounded-lg border border-line bg-white p-4 text-sm"><h2 className="mb-2 font-semibold">Commission</h2>
          <p>Plan: {sub ? `${sub.plan.name}${sub.plan.commissionBps != null ? ` (${sub.plan.commissionBps / 100}%)` : ""}, until ${d(sub.currentPeriodEnd)}` : "none — category/default rules apply"}</p>
          {rules.map((r) => <p key={r.id}>Vendor override: {r.name} · {r.rateBps / 100}%</p>)}
        </section>
        <section><h2 className="mb-2 font-semibold">Bank accounts</h2>
          <Table><thead><tr><Th>Account</Th><Th>Country / currency</Th><Th>Provider</Th><Th>Status</Th><Th>Added</Th></tr></thead>
            <tbody>{bens.length === 0 ? <tr><Td colSpan={5} className="py-6 text-center text-ink-muted">No bank accounts.</Td></tr> : bens.map((b) => <tr key={b.id}><Td>{b.bankName} ••••{b.accountLast4}<span className="block text-[11px] text-ink-muted">{b.verifiedName ?? b.accountHolderName}{b.isDefault && " · default"}</span></Td><Td>{b.country} / {b.currency}</Td><Td>{b.providerKey}</Td><Td><StatusBadge status={b.status} /></Td><Td>{d(b.createdAt)}</Td></tr>)}</tbody>
          </Table>
        </section>
        <section><h2 className="mb-2 font-semibold">Payouts</h2>
          <Table><thead><tr><Th>Requested</Th><Th className="text-right">Amount</Th><Th>Method</Th><Th>Status</Th><Th>Reference</Th></tr></thead>
            <tbody>{payouts.length === 0 ? <tr><Td colSpan={5} className="py-6 text-center text-ink-muted">No payouts.</Td></tr> : payouts.map((p) => <tr key={p.id}><Td><Link href={`/admin/payouts?id=${p.id}`} className="hover:text-brand">{d(p.createdAt)}</Link></Td><Td className="tabular text-right">{formatMoney(p.amountMinor)}{p.settlementCurrency && p.settlementCurrency !== p.currency && <span className="block text-[11px] text-ink-muted">→ {p.settlementCurrency}</span>}</Td><Td>{p.method.toLowerCase().replace("_", "-")} · {p.providerKey}</Td><Td><StatusBadge status={p.status} /></Td><Td className="font-mono text-[12px]">{p.providerRef ?? "—"}</Td></tr>)}</tbody>
          </Table>
        </section>
      </div>
    );
  }
  if (tab === "shipping") {
    const [methods, pickups, shipments] = await Promise.all([
      db.shippingMethod.findMany({ where: { vendorId: id } }),
      db.pickupAddress.findMany({ where: { vendorId: id } }),
      db.shipment.groupBy({ by: ["status"], where: { vendorOrder: { vendorId: id } }, _count: true }),
    ]);
    return (
      <div className="grid gap-6 lg:grid-cols-2 text-sm">
        <section className="rounded-lg border border-line bg-white p-4"><h2 className="mb-2 font-semibold">Delivery methods</h2>{methods.length === 0 ? <p className="text-ink-muted">None.</p> : <ul className="space-y-1">{methods.map((m) => <li key={m.id}>{m.name} · {m.type.toLowerCase()} · {formatMoney(m.rateMinor)}{m.destinationCountries.length > 0 && ` · to ${m.destinationCountries.join(", ")}`}{!m.active && " (inactive)"}</li>)}</ul>}</section>
        <section className="rounded-lg border border-line bg-white p-4"><h2 className="mb-2 font-semibold">Pickup addresses</h2>{pickups.length === 0 ? <p className="text-ink-muted">None.</p> : <ul className="space-y-1">{pickups.map((a) => <li key={a.id}>{a.label}: {[a.line1, a.city, a.region, a.country].filter(Boolean).join(", ")}</li>)}</ul>}</section>
        <section className="rounded-lg border border-line bg-white p-4"><h2 className="mb-2 font-semibold">Shipments by status</h2>{shipments.length === 0 ? <p className="text-ink-muted">None.</p> : <ul>{shipments.map((s) => <li key={s.status}>{s.status.toLowerCase().replace(/_/g, " ")}: {s._count}</li>)}</ul>}</section>
      </div>
    );
  }
  if (tab === "activity") {
    const logs = await db.auditLog.findMany({ where: { OR: [{ entityType: "Vendor", entityId: id }, { actor: { vendorsOwned: { some: { id } } } }] }, orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { name: true } } } });
    return <ul className="divide-y divide-line rounded-lg border border-line bg-white text-sm">{logs.length === 0 ? <li className="px-4 py-3 text-ink-muted">No activity.</li> : logs.map((l) => <li key={l.id} className="px-4 py-2"><span className="font-medium">{l.action}</span> · {l.entityType} · {l.actor?.name ?? "system"} · {l.createdAt.toLocaleString("en-NG")}</li>)}</ul>;
  }
  return null;
}
