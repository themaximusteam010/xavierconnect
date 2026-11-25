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

export default async function VendorDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const u = await guard("vendor.view");
  const { id } = await params;
  const sp = await searchParams;
  const v = await db.vendor.findUnique({ where: { id }, include: { store: true, owner: true, documents: true, shippingMethods: true, payoutAccount: true, _count: { select: { products: true, vendorOrders: true } } } });
  if (!v) notFound();
  const [bal, logs] = await Promise.all([
    u.permissions.has("finance.view") ? vendorBalances(db, id) : null,
    db.auditLog.findMany({ where: { entityType: "Vendor", entityId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { actor: { select: { name: true } } } }),
  ]);
  const canDecide = u.permissions.has("vendor.approve");
  const row = (k: string, val: React.ReactNode) => <div className="grid grid-cols-[160px_1fr] gap-3 px-4 py-2.5"><dt className="text-ink-muted">{k}</dt><dd>{val || "—"}</dd></div>;
  return (
    <>
      <PageHeader eyebrow="Vendor" title={v.store?.name ?? v.businessName} description={<span className="flex items-center gap-2"><StatusBadge status={v.status} /> {v.verificationLevel.replace(/_/g, " ").toLowerCase()} {v.store && v.status === "APPROVED" && <Link href={`/store/${v.store.slug}`} className="text-brand underline">View store</Link>}</span>} />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      {bal && <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Pending" value={formatMoney(bal.pending)} /><Stat label="Available" value={formatMoney(bal.available)} /><Stat label="In withdrawal" value={formatMoney(bal.payoutHold)} /><Stat label="Orders / listings" value={`${v._count.vendorOrders} / ${v._count.products}`} /></div>}
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-line bg-white"><h2 className="border-b border-line px-4 py-3 font-semibold">Application</h2>
            <dl className="divide-y divide-line text-sm">
              {row("Type", v.type.replace(/_/g, " ").toLowerCase())}{row("Business name", v.businessName)}{row("CAC number", v.rcNumber)}{row("Category", v.businessCategory)}
              {row("Description", <span className="whitespace-pre-line">{v.description}</span>)}{row("Owner", `${v.owner.name} · ${v.owner.email}${v.owner.emailVerifiedAt ? " (verified)" : " (unverified)"}`)}
              {row("Business contact", `${v.email} · ${v.phone}`)}{row("Address", [v.addressLine1, v.city, v.state].filter(Boolean).join(", "))}{row("Website", v.website)}
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
      </div>
    </>
  );
}
