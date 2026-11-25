/**
 * Operational monitoring. Each check upserts an AdminAlert by dedupe key and auto-resolves it when the
 * condition clears. Run by the scheduled job; alerts are listed on the admin overview and Integrations.
 */
import { db } from "@/server/db";
import { sendEmail } from "./notify";

export interface AlertInput { dedupeKey: string; type: string; severity: "INFO" | "WARNING" | "CRITICAL"; title: string; detail?: string; link?: string }

export async function raiseAlert(a: AlertInput) {
  const existing = await db.adminAlert.findUnique({ where: { dedupeKey: a.dedupeKey } });
  if (existing && !existing.resolvedAt) {
    return db.adminAlert.update({ where: { id: existing.id }, data: { count: { increment: 1 }, lastSeenAt: new Date(), detail: a.detail, severity: a.severity } });
  }
  const row = existing
    ? await db.adminAlert.update({ where: { id: existing.id }, data: { ...a, count: 1, firstSeenAt: new Date(), lastSeenAt: new Date(), resolvedAt: null, resolvedById: null } })
    : await db.adminAlert.create({ data: a });
  if (a.severity === "CRITICAL" && process.env.OPS_ALERT_EMAIL) {
    await sendEmail(db, { to: process.env.OPS_ALERT_EMAIL, subject: `[XavierConnect] ${a.title}`, text: `${a.detail ?? ""}\n\n${process.env.APP_URL ?? ""}${a.link ?? "/admin"}` }).catch(() => {});
  }
  return row;
}

export async function resolveAlert(dedupeKey: string, actorId?: string) {
  await db.adminAlert.updateMany({ where: { dedupeKey, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: actorId ?? null } });
}

async function check(key: string, condition: boolean, a: Omit<AlertInput, "dedupeKey">) {
  if (condition) await raiseAlert({ dedupeKey: key, ...a });
  else await resolveAlert(key);
}

export async function runMonitoring(now = new Date()) {
  const h = (n: number) => new Date(now.getTime() - n * 3600_000);
  const [failedPayments, stalePending, delayedPayouts, deadLetters, providerErrors, quietShipments, emailBacklog, slowReviews, bigOrders, failedRefunds] = await Promise.all([
    db.payment.count({ where: { status: "FAILED", updatedAt: { gte: h(24) } } }),
    db.payment.count({ where: { status: "INITIATED", createdAt: { lt: h(1), gte: h(48) }, order: { status: "PENDING_PAYMENT" } } }),
    db.payout.count({ where: { status: "PROCESSING", initiatedAt: { lt: h(72) } } }),
    db.paymentEvent.count({ where: { deadLetteredAt: { not: null }, processedAt: null } }),
    db.integrationLog.count({ where: { status: "ERROR", createdAt: { gte: h(1) } } }),
    db.shipment.count({ where: { status: { in: ["IN_TRANSIT", "PICKED_UP", "OUT_FOR_DELIVERY"] }, OR: [{ lastEventAt: { lt: h(120) } }, { lastEventAt: null, shippedAt: { lt: h(120) } }] } }),
    db.emailOutbox.count({ where: { OR: [{ status: "FAILED" }, { status: "PENDING", createdAt: { lt: h(1) } }] } }),
    db.vendor.count({ where: { status: "SUBMITTED", submittedAt: { lt: h(72) } } }),
    db.order.count({ where: { paidAt: { gte: h(24) }, totalMinor: { gte: 500_000_000n } } }), // ≥ ₦5m in a single order
    db.refund.count({ where: { status: "FAILED" } }),
  ]);
  await check("payments:failed-24h", failedPayments >= 5, { type: "PAYMENT_FAILED", severity: "WARNING", title: `${failedPayments} failed payments in 24 hours`, link: "/admin/payments?status=FAILED" });
  await check("payments:pending-webhooks", stalePending > 0, { type: "PAYMENT_PENDING", severity: "INFO", title: `${stalePending} payments still awaiting provider confirmation after 1 hour`, link: "/admin/payments?status=INITIATED" });
  await check("payouts:delayed", delayedPayouts > 0, { type: "PAYOUT_DELAYED", severity: "WARNING", title: `${delayedPayouts} payouts processing for more than 3 days`, link: "/admin/payouts?status=PROCESSING" });
  await check("webhooks:dead-letter", deadLetters > 0, { type: "WEBHOOK_DEAD_LETTER", severity: "CRITICAL", title: `${deadLetters} provider webhooks failed after all retries`, link: "/admin/integrations?tab=webhooks" });
  await check("integrations:errors-1h", providerErrors >= 3, { type: "INTEGRATION_ERROR", severity: "WARNING", title: `${providerErrors} provider API errors in the last hour`, link: "/admin/integrations?tab=logs" });
  await check("shipping:no-tracking", quietShipments > 0, { type: "SHIPMENT_DELAYED", severity: "WARNING", title: `${quietShipments} shipments with no tracking update for 5 days`, link: "/admin/shipments?stale=1" });
  await check("email:backlog", emailBacklog > 0, { type: "NOTIFICATION_FAILED", severity: "WARNING", title: `${emailBacklog} emails failed or unsent`, detail: "EMAIL_TRANSPORT is not sending real email until an SMTP/Resend worker is configured.", link: "/admin/settings" });
  await check("vendors:review-backlog", slowReviews > 0, { type: "VENDOR_VERIFICATION", severity: "INFO", title: `${slowReviews} vendor applications waiting more than 3 days`, link: "/admin/vendor-verification" });
  await check("risk:large-orders", bigOrders > 0, { type: "SUSPICIOUS_TRANSACTION", severity: "INFO", title: `${bigOrders} orders of ₦5,000,000 or more in 24 hours — review`, link: "/admin/payments?min=5000000" });
  await check("refunds:failed", failedRefunds > 0, { type: "REFUND_FAILED", severity: "CRITICAL", title: `${failedRefunds} refunds failed at the provider`, link: "/admin/payments?refunds=failed" });

  // Repeated payment failures by the same customer within an hour.
  const rows = await db.$queryRaw<{ userId: string; n: bigint }[]>`
    SELECT o."userId", count(*)::bigint AS n FROM "Payment" p JOIN "Order" o ON o.id = p."orderId"
     WHERE p.status = 'FAILED' AND p."updatedAt" >= ${h(1)} AND o."userId" IS NOT NULL GROUP BY o."userId" HAVING count(*) >= 3`;
  for (const r of rows) await raiseAlert({ dedupeKey: `risk:card-testing:${r.userId}`, type: "SUSPICIOUS_TRANSACTION", severity: "WARNING", title: `Customer had ${r.n} failed payments in an hour`, link: `/admin/customers/${r.userId}` });
}
