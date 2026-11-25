/**
 * Provider webhooks: verify → store once (unique provider+eventKey) → process → retry with backoff →
 * dead-letter after MAX_ATTEMPTS with an admin alert. The normalised event is stored so retries never
 * need the signature again. Processing functions are themselves idempotent.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { paymentAdapter, providerContext, shippingAdapter } from "@/server/integrations/registry";
import { paystackTransfers } from "@/server/integrations/payments/paystack-transfers";
import type { TrackingUpdate } from "@/server/integrations/types";
import { confirmPayment } from "./orders";
import { applyPayoutOutcome } from "./payouts";
import { applyTrackingUpdate } from "./shipping";
import { raiseAlert } from "./monitoring";

const MAX_ATTEMPTS = 5;

type Normalised =
  | { kind: "PAYMENT"; type: string; reference: string | null }
  | { kind: "PAYOUT"; type: string; reference: string | null; outcome?: "SUCCESS" | "FAILED" | "REVERSED"; message?: string }
  | { kind: "SHIPPING"; type: string; update: Omit<TrackingUpdate, "occurredAt" | "payload"> & { occurredAt: string } };

export async function ingestWebhook(providerKey: string, rawBody: string, headers: Headers): Promise<{ status: number; body: string }> {
  const ctx = await providerContext(providerKey);
  let eventKey: string;
  let normalised: Normalised;

  const pay = paymentAdapter(providerKey);
  const ship = shippingAdapter(providerKey);
  if (providerKey === "paystack") {
    const e = paystackTransfers.parseWebhook!(ctx, rawBody, headers);
    if (!e) return { status: 401, body: "Invalid signature" };
    eventKey = e.eventKey;
    normalised = e.type.startsWith("transfer.") ? { kind: "PAYOUT", type: e.type, reference: e.reference, outcome: e.outcome, message: e.message } : { kind: "PAYMENT", type: e.type, reference: e.reference };
  } else if (pay?.parseWebhook) {
    const e = pay.parseWebhook(ctx, rawBody, headers);
    if (!e) return { status: 401, body: "Invalid signature" };
    eventKey = e.eventKey;
    normalised = { kind: "PAYOUT", type: e.type, reference: e.reference, outcome: e.outcome, message: e.message };
  } else if (ship?.parseWebhook) {
    const u = ship.parseWebhook(ctx, rawBody, headers);
    if (!u) return { status: 401, body: "Invalid signature" };
    eventKey = u.eventKey;
    normalised = { kind: "SHIPPING", type: "tracking", update: { eventKey: u.eventKey, providerShipmentId: u.providerShipmentId, status: u.status, note: u.note, location: u.location, occurredAt: u.occurredAt.toISOString() } };
  } else {
    return { status: 404, body: "Unknown provider" };
  }

  let row;
  try {
    row = await db.paymentEvent.create({
      data: { provider: providerKey, eventKey, type: normalised.type, kind: normalised.kind, signatureOk: true, payload: { normalised, raw: safeJson(rawBody) } as Prisma.InputJsonValue },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: 200, body: "duplicate" };
    throw e;
  }
  const ok = await processEvent(row.id);
  // Acknowledge even on processing failure: the event is stored and our own retry loop owns it now.
  return { status: 200, body: ok ? "ok" : "queued for retry" };
}

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return { raw: s.slice(0, 2000) }; }
}

export async function processEvent(id: string): Promise<boolean> {
  const ev = await db.paymentEvent.findUniqueOrThrow({ where: { id } });
  if (ev.processedAt) return true;
  const n = (ev.payload as { normalised: Normalised }).normalised;
  try {
    if (n.kind === "PAYMENT") {
      if (n.type === "charge.success" && n.reference) await confirmPayment(n.reference);
    } else if (n.kind === "PAYOUT") {
      if (n.reference && n.outcome) await applyPayoutOutcome(ev.provider, n.reference, n.outcome, n.message);
    } else {
      await applyTrackingUpdate(ev.provider, { ...n.update, occurredAt: new Date(n.update.occurredAt), payload: null });
    }
    await db.paymentEvent.update({ where: { id }, data: { processedAt: new Date(), error: null, attempts: { increment: 1 }, nextRetryAt: null } });
    return true;
  } catch (e) {
    const attempts = ev.attempts + 1;
    const dead = attempts >= MAX_ATTEMPTS;
    await db.paymentEvent.update({
      where: { id },
      data: { attempts, error: (e as Error).message.slice(0, 500), nextRetryAt: dead ? null : new Date(Date.now() + 2 ** attempts * 60_000), deadLetteredAt: dead ? new Date() : null },
    });
    if (dead) await raiseAlert({ dedupeKey: `webhook-dead:${id}`, type: "WEBHOOK_DEAD_LETTER", severity: "CRITICAL", title: `${ev.provider} ${ev.type} could not be processed`, detail: (e as Error).message, link: "/admin/integrations?tab=webhooks" });
    return false;
  }
}

export async function retryDueWebhooks(now = new Date()) {
  const due = await db.paymentEvent.findMany({ where: { processedAt: null, deadLetteredAt: null, nextRetryAt: { lte: now } }, select: { id: true }, take: 100 });
  let ok = 0;
  for (const d of due) if (await processEvent(d.id)) ok++;
  return { attempted: due.length, ok };
}

/** Manual replay from the dead-letter queue by an admin. */
export async function replayDeadLetter(id: string) {
  await db.paymentEvent.update({ where: { id }, data: { deadLetteredAt: null, attempts: 0, nextRetryAt: new Date() } });
  return processEvent(id);
}
