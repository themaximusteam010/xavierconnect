import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { refundAction, assignDeliveryAction } from "@/app/actions/admin";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";

export default async function AdminOrder({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const u = await guard("order.view_all");
  const { number } = await params;
  const sp = await searchParams;
  const o = await db.order.findUnique({ where: { number }, include: { user: true, payments: { orderBy: { createdAt: "asc" } }, refunds: true, vendorOrders: { orderBy: { number: "asc" }, include: { vendor: { include: { store: true } }, items: true, shipments: { include: { deliveryPartner: { select: { name: true } } } } } } } });
  if (!o) notFound();
  const ledger = await db.ledgerTransaction.findMany({ where: { reference: { startsWith: o.number } }, orderBy: { createdAt: "asc" }, include: { entries: { include: { account: true } } } });
  const partners = u.permissions.has("order.manage") ? await db.user.findMany({ where: { roles: { some: { role: { key: "DELIVERY_PARTNER" } } }, status: "ACTIVE" }, select: { id: true, name: true } }) : [];
  const canRefund = u.permissions.has("finance.refund.approve");
  return (
    <>
      <PageHeader eyebrow="Order" title={o.number} description={<span className="flex items-center gap-2"><StatusBadge status={o.status} /><StatusBadge status={o.paymentStatus} /> {o.user?.email ?? `${o.guestEmail} (guest)`}</span>} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <div className="space-y-6">
        {o.vendorOrders.map((vo) => (
          <section key={vo.id} className="rounded-lg border border-line bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 text-sm"><span><b>{vo.number}</b> · {vo.vendor.store?.name}</span><StatusBadge status={vo.status} /></header>
            <ul className="divide-y divide-line text-sm">{vo.items.map((it) => <li key={it.id} className="flex justify-between px-4 py-2"><span>{it.quantity} × {it.name}</span><span className="tabular">{formatMoney(it.lineTotalMinor)} <span className="text-ink-muted">(comm. {formatMoney(it.commissionMinor)})</span></span></li>)}</ul>
            <div className="tabular flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-4 py-2 text-[13px] text-ink-muted"><span>Total {formatMoney(vo.totalMinor)}</span><span>Commission {formatMoney(vo.commissionMinor)}</span><span>Vendor net {formatMoney(vo.vendorNetMinor)}</span><span>Settled {vo.settledAt ? vo.settledAt.toLocaleDateString("en-NG") : "no"}</span></div>
            {vo.shipments.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2 text-[13px]">
                <span>Shipment {s.carrier}{s.trackingNumber ? ` · ${s.trackingNumber}` : ""} · <StatusBadge status={s.status} /> {s.deliveryPartner && `· rider ${s.deliveryPartner.name}`}</span>
                {partners.length > 0 && s.status !== "DELIVERED" && (
                  <form action={assignDeliveryAction} className="flex gap-2"><input type="hidden" name="shipmentId" value={s.id} /><input type="hidden" name="number" value={o.number} />
                    <Select name="partnerId" defaultValue={s.deliveryPartnerId ?? ""} className="h-8 w-44 text-[13px]"><option value="">Unassigned</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                    <SubmitButton size="sm" variant="secondary">Assign</SubmitButton></form>
                )}
              </div>
            ))}
            {canRefund && o.paymentStatus !== "UNPAID" && !["REFUNDED", "CANCELLED", "AWAITING_PAYMENT"].includes(vo.status) && (
              <form action={refundAction} className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
                <input type="hidden" name="vendorOrderId" value={vo.id} /><input type="hidden" name="number" value={o.number} />
                <Input name="reason" placeholder="Refund reason (shown to customer)" className="h-8 max-w-sm" required />
                <SubmitButton size="sm" variant="danger" confirm={`Refund ${formatMoney(vo.totalMinor)} for ${vo.number}?`}>Refund this shipment</SubmitButton>
              </form>
            )}
          </section>
        ))}
        <section>
          <h2 className="mb-3 font-semibold">Payments</h2>
          <Table><thead><tr><Th>Reference</Th><Th>Provider</Th><Th>Status</Th><Th>Verified</Th><Th className="text-right">Amount</Th></tr></thead>
            <tbody>{o.payments.map((p) => <tr key={p.id}><Td className="font-mono text-[12px]">{p.reference}</Td><Td>{p.provider}</Td><Td><StatusBadge status={p.status} />{p.failureReason && <span className="block text-[12px] text-danger">{p.failureReason}</span>}</Td><Td>{p.verifiedAt?.toLocaleString("en-NG") ?? "—"}</Td><Td className="tabular text-right">{formatMoney(p.amountMinor)}</Td></tr>)}</tbody>
          </Table>
          {o.refunds.length > 0 && <ul className="mt-3 space-y-1 text-sm">{o.refunds.map((r) => <li key={r.id}>Refund {formatMoney(r.amountMinor)} · <StatusBadge status={r.status} /> · {r.reason}</li>)}</ul>}
        </section>
        {u.permissions.has("finance.view") && (
          <section>
            <h2 className="mb-3 font-semibold">Ledger</h2>
            <Table><thead><tr><Th>When</Th><Th>Transaction</Th><Th>Account</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th></tr></thead>
              <tbody>{ledger.flatMap((t) => t.entries.map((e, i) => <tr key={e.id}><Td>{i === 0 ? t.createdAt.toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" }) : ""}</Td><Td>{i === 0 ? t.kind : ""}</Td><Td className="font-mono text-[12px]">{e.account.code}</Td><Td className="tabular text-right">{e.debitMinor > 0n ? formatMoney(e.debitMinor) : ""}</Td><Td className="tabular text-right">{e.creditMinor > 0n ? formatMoney(e.creditMinor) : ""}</Td></tr>))}</tbody>
            </Table>
          </section>
        )}
      </div>
    </>
  );
}
