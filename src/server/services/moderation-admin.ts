/**
 * Moderator workflows. Privacy policy (docs/MESSAGING_POLICY.md):
 *  - Staff never browse private conversations. They see (a) messages and files the automatic checks
 *    held or blocked, and (b) the transcript of a conversation only while it has a user report.
 *  - Every moderator action and every transcript view is written to the audit log.
 *  - Suspending an account is a separate, explicit staff decision (user.manage), never automatic.
 */
import { db } from "@/server/db";
import { audit } from "./audit";
import { notify } from "./notify";
import { afterDelivery, applyEnforcement, clearRulesCache, type Side } from "./messaging";
import { deleteStored } from "@/server/storage";
import { getSetting } from "./settings";

export class ModerationError extends Error {}

export async function approveHeld(actorId: string, messageId: string, note?: string) {
  const m = await db.message.findUnique({ where: { id: messageId }, include: { conversation: true, sender: { select: { id: true, name: true } } } });
  if (!m || m.status !== "HELD") throw new ModerationError("This message is no longer waiting for review.");
  await db.message.update({ where: { id: m.id }, data: { status: "DELIVERED", moderation: "APPROVED", deliveredAt: new Date() } });
  await db.moderationEvent.create({ data: { userId: m.senderId, conversationId: m.conversationId, messageId: m.id, decision: "APPROVED", categories: [], source: "MODERATOR", actorId, note: note || null } });
  await afterDelivery(m.conversation, m.senderSide as Side, m.sender, m.id);
  await audit(db, { actorId, action: "moderation.message.approve", entityType: "Message", entityId: m.id, after: { note } });
}

export async function rejectHeld(actorId: string, messageId: string, opts: { note?: string; violation: boolean }) {
  const m = await db.message.findUnique({ where: { id: messageId } });
  if (!m || m.status !== "HELD") throw new ModerationError("This message is no longer waiting for review.");
  await db.message.update({ where: { id: m.id }, data: { status: "BLOCKED", moderation: "BLOCKED" } });
  await db.moderationEvent.create({ data: { userId: m.senderId, conversationId: m.conversationId, messageId: m.id, decision: "BLOCKED", categories: ["MODERATOR"], source: "MODERATOR", actorId, note: opts.note || null, confirmed: opts.violation } });
  if (opts.violation) await applyEnforcement(m.senderId);
  await notify(db, { userId: m.senderId, type: "message.moderation", title: "A message wasn't delivered", body: "Our team reviewed a message you sent and didn't deliver it because it appeared to share contact details or arrange payment outside XavierConnect. Keep conversations and payments on XavierConnect so your purchase stays protected.", email: false });
  await audit(db, { actorId, action: "moderation.message.reject", entityType: "Message", entityId: m.id, after: { violation: opts.violation, note: opts.note } });
}

export async function reviewAttachment(actorId: string, attachmentId: string, decision: "APPROVED" | "BLOCKED", opts: { note?: string; violation?: boolean } = {}) {
  const a = await db.messageAttachment.findUnique({ where: { id: attachmentId }, include: { message: true } });
  if (!a || !["REVIEW", "PENDING", "BLOCKED"].includes(a.status)) throw new ModerationError("This attachment is not awaiting review.");
  if (decision === "APPROVED" && !a.storageKey) throw new ModerationError("This file was not kept and cannot be released.");
  if (decision === "APPROVED" && a.message.status !== "DELIVERED") throw new ModerationError("Approve the message itself first.");
  if (decision === "BLOCKED" && a.storageKey) await deleteStored(a.storageKey);
  await db.messageAttachment.update({ where: { id: a.id }, data: { status: decision, reviewedById: actorId, reviewedAt: new Date(), ...(decision === "BLOCKED" ? { storageKey: null } : {}) } });
  await db.moderationEvent.create({ data: { userId: a.uploaderId, conversationId: a.message.conversationId, messageId: a.messageId, attachmentId: a.id, decision: decision === "APPROVED" ? "APPROVED" : "ATTACHMENT_BLOCKED", categories: [], source: "MODERATOR", actorId, note: opts.note || null, confirmed: decision === "BLOCKED" && !!opts.violation } });
  if (decision === "BLOCKED" && opts.violation) await applyEnforcement(a.uploaderId);
  await audit(db, { actorId, action: `moderation.attachment.${decision.toLowerCase()}`, entityType: "MessageAttachment", entityId: a.id, after: { note: opts.note, violation: opts.violation } });
}

export async function resolveReport(actorId: string, reportId: string, status: "RESOLVED" | "DISMISSED", resolution: string) {
  if (resolution.trim().length < 5) throw new ModerationError("Record what you decided.");
  const r = await db.messageReport.findUnique({ where: { id: reportId } });
  if (!r || r.status !== "OPEN") throw new ModerationError("Report is already closed.");
  await db.messageReport.update({ where: { id: r.id }, data: { status, resolution: resolution.trim(), resolvedById: actorId, resolvedAt: new Date() } });
  await notify(db, { userId: r.reporterId, type: "message.moderation", title: "We reviewed your report", body: "Thanks for reporting a conversation. Our team has reviewed it and taken appropriate action.", email: false });
  await audit(db, { actorId, action: `moderation.report.${status.toLowerCase()}`, entityType: "MessageReport", entityId: r.id, after: { resolution } });
}

/** A moderator may read a transcript only while the conversation has an open report. Logged every time. */
export async function reportedTranscript(actorId: string, conversationId: string) {
  const report = await db.messageReport.findFirst({ where: { conversationId, status: "OPEN" } });
  if (!report) throw new ModerationError("Transcripts are only available for conversations with an open report.");
  await audit(db, { actorId, action: "moderation.transcript.view", entityType: "Conversation", entityId: conversationId, after: { reportId: report.id } });
  return db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: {
      customer: { select: { id: true, name: true } }, vendor: { select: { id: true, businessName: true, ownerId: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 200, include: { sender: { select: { name: true } }, attachments: { select: { id: true, fileName: true, status: true, mimeType: true } } } },
    },
  });
}

export async function restrictUser(actorId: string, userId: string, hours: number | null, reason: string) {
  if (reason.trim().length < 5) throw new ModerationError("Give a reason.");
  const r = await db.userMessagingRestriction.create({ data: { userId, kind: "MUTE", reason: reason.trim(), endsAt: hours ? new Date(Date.now() + hours * 3600_000) : null, createdById: actorId } });
  await notify(db, { userId, type: "message.moderation", title: "Your messaging has been paused", body: `${hours ? `For ${hours} hours. ` : ""}Reason: ${reason.trim()}`, email: true });
  await audit(db, { actorId, action: "moderation.restrict", entityType: "User", entityId: userId, after: { hours, reason } });
  return r;
}

export async function liftRestriction(actorId: string, restrictionId: string) {
  const r = await db.userMessagingRestriction.update({ where: { id: restrictionId }, data: { liftedAt: new Date(), liftedById: actorId } });
  await audit(db, { actorId, action: "moderation.restriction.lift", entityType: "User", entityId: r.userId, after: { restrictionId, kind: r.kind } });
}

export const RULE_KINDS = { BLOCK_TERM: "Block messages containing", REVIEW_TERM: "Hold for review messages containing", ALLOW_DOMAIN: "Allow links to domain", DETECTOR_OFF: "Turn off detector" } as const;

export async function saveRule(actorId: string, kind: keyof typeof RULE_KINDS, value: string, note?: string) {
  const v = value.trim().toLowerCase();
  if (v.length < 2 || v.length > 100) throw new ModerationError("Enter 2–100 characters.");
  if (kind === "ALLOW_DOMAIN" && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) throw new ModerationError("Enter a domain like example.com.");
  if (kind === "DETECTOR_OFF" && !["EMAIL", "PHONE", "URL", "MESSAGING_HANDLE", "OFF_PLATFORM_PAYMENT"].includes(value)) throw new ModerationError("Unknown detector.");
  const r = await db.moderationRule.upsert({ where: { kind_value: { kind, value: kind === "DETECTOR_OFF" ? value : v } }, update: { enabled: true, note: note || null }, create: { kind, value: kind === "DETECTOR_OFF" ? value : v, note: note || null, createdById: actorId } });
  clearRulesCache();
  await audit(db, { actorId, action: "moderation.rule.save", entityType: "ModerationRule", entityId: r.id, after: { kind, value: r.value } });
}

export async function toggleRule(actorId: string, id: string) {
  const r = await db.moderationRule.findUniqueOrThrow({ where: { id } });
  await db.moderationRule.update({ where: { id }, data: { enabled: !r.enabled } });
  clearRulesCache();
  await audit(db, { actorId, action: "moderation.rule.toggle", entityType: "ModerationRule", entityId: id, after: { enabled: !r.enabled } });
}

/** Retention: blocked text is redacted and flagged/unreleased files deleted after the configured period. */
export async function purgeModerationRetention(now = new Date()) {
  const days = await getSetting(db, "msgBlockedRetentionDays");
  const cutoff = new Date(now.getTime() - days * 864e5);
  const redacted = await db.message.updateMany({ where: { status: "BLOCKED", createdAt: { lt: cutoff }, NOT: { body: "[removed under retention policy]" } }, data: { body: "[removed under retention policy]" } });
  const files = await db.messageAttachment.findMany({ where: { status: { in: ["BLOCKED", "REVIEW"] }, createdAt: { lt: cutoff }, storageKey: { not: null } }, select: { id: true, storageKey: true } });
  for (const f of files) { await deleteStored(f.storageKey!); await db.messageAttachment.update({ where: { id: f.id }, data: { storageKey: null, status: "BLOCKED" } }); }
  return { redacted: redacted.count, files: files.length };
}
