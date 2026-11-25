/**
 * Reconciliation: compare our records with what providers report.
 *  - Payments marked SUCCEEDED in the window are re-verified with the provider (amount + status).
 *  - API payouts marked PAID must have a provider confirmation event; manual payouts are UNVERIFIABLE
 *    until a bank statement import exists (documented gap).
 * Each run writes ReconciliationRecord rows and raises an alert on any mismatch.
 */
import { db } from "@/server/db";
import { getProvider } from "@/server/payments";
import { raiseAlert } from "./monitoring";

export async function runReconciliation(sinceDays = 2, now = new Date()) {
  const since = new Date(now.getTime() - sinceDays * 864e5);
  const runAt = now;
  let mismatches = 0;

  const payments = await db.payment.findMany({ where: { status: "SUCCEEDED", verifiedAt: { gte: since } }, take: 500 });
  for (const p of payments) {
    let status = "MATCHED", providerAmount: bigint | null = null, detail: string | null = null;
    try {
      const v = await getProvider(p.provider).verify(p.reference);
      providerAmount = v.amountMinor;
      if (v.status !== "success") { status = "STATUS_MISMATCH"; detail = `Provider reports ${v.status}`; }
      else if (v.amountMinor !== p.amountMinor || v.currency !== p.currency) { status = "AMOUNT_MISMATCH"; detail = `Provider ${v.amountMinor} ${v.currency}`; }
    } catch (e) {
      status = "UNVERIFIABLE"; detail = (e as Error).message.slice(0, 300);
    }
    if (status !== "MATCHED" && status !== "UNVERIFIABLE") mismatches++;
    await db.reconciliationRecord.create({ data: { runAt, providerKey: p.provider, kind: "PAYMENT", reference: p.reference, internalAmountMinor: p.amountMinor, providerAmountMinor: providerAmount, currency: p.currency, status, detail } });
  }

  const payouts = await db.payout.findMany({ where: { status: "PAID", paidAt: { gte: since } }, include: { events: true } });
  for (const p of payouts) {
    const manual = !p.providerKey || p.providerKey === "manual";
    const confirmed = p.events.some((e) => e.status === "PAID" && (e.message ?? "").startsWith("Provider confirmed"));
    const status = manual ? "UNVERIFIABLE" : confirmed ? "MATCHED" : "STATUS_MISMATCH";
    if (status === "STATUS_MISMATCH") mismatches++;
    await db.reconciliationRecord.create({ data: { runAt, providerKey: p.providerKey ?? "manual", kind: "PAYOUT", reference: p.providerRef ?? p.id, internalAmountMinor: p.amountMinor, currency: p.currency, status, detail: manual ? "Manual transfer — reconcile against the bank statement" : confirmed ? null : "Marked paid without provider confirmation" } });
  }

  if (mismatches) await raiseAlert({ dedupeKey: `recon:${runAt.toISOString().slice(0, 10)}`, type: "RECONCILIATION", severity: "CRITICAL", title: `${mismatches} reconciliation mismatches`, link: "/admin/finance?tab=reconciliation" });
  return { payments: payments.length, payouts: payouts.length, mismatches };
}
