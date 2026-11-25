/**
 * Private buyer–vendor messaging.
 *
 * Authorisation (server-side, every call): a user may act in a conversation only as
 *   - CUSTOMER: conversation.customerId === user.id, or
 *   - VENDOR:   the user holds the "messages" capability for conversation.vendorId.
 * Anyone else gets the same "not found" as a non-existent id.
 *
 * Delivery: text is moderated (detect.ts) and attachments inspected (attachments.ts) BEFORE the
 * message row is marked DELIVERED. Only DELIVERED messages, and only APPROVED attachments, are ever
 * returned to the other side. Blocked text is stored for the audit trail (purged after the retention
 * period) but never returned to the recipient.
 */
import { createHash } from "node:crypto";
import { db } from "@/server/db";
import type { RoleGrant } from "@/server/auth/rbac";
import { hasVendorCapability } from "@/server/auth/rbac";
import { moderateText, SENDER_BLOCK_MESSAGE, EMPTY_RULES, type Finding, type RuleSet, type Category } from "@/server/moderation/detect";
import { inspectAttachment, validateAttachment, AttachmentError, type Inspection } from "@/server/moderation/attachments";
import { savePrivateBytes } from "@/server/storage";
import { getSetting } from "./settings";
import { notify } from "./notify";
import { raiseAlert } from "./monitoring";
import { audit } from "./audit";

export class MessagingError extends Error {
  constructor(public code: "NOT_FOUND" | "FORBIDDEN" | "INVALID" | "RESTRICTED" | "BLOCKED_CONVERSATION" | "RATE_LIMITED", message: string) { super(message); }
}

export interface Actor { id: string; name: string; grants: RoleGrant[]; vendorIds: string[]; emailVerified: boolean }
export type Side = "CUSTOMER" | "VENDOR";
export const MAX_BODY = 2000;
export const MAX_FILES = 4;
const ONLINE_MS = 60_000;

// ─── Authorisation ───────────────────────────────────────────────────────────

export async function authorize(actor: Actor, conversationId: string, prefer?: Side) {
  const conv = await db.conversation.findUnique({ where: { id: conversationId }, include: { vendor: { include: { store: true } }, customer: { select: { id: true, name: true, lastSeenAt: true } } } });
  if (!conv) throw new MessagingError("NOT_FOUND", "Conversation not found.");
  const asCustomer = conv.customerId === actor.id;
  const asVendor = hasVendorCapability(actor.grants, conv.vendorId, "messages");
  const side: Side | null = prefer === "VENDOR" && asVendor ? "VENDOR" : prefer === "CUSTOMER" && asCustomer ? "CUSTOMER" : asCustomer ? "CUSTOMER" : asVendor ? "VENDOR" : null;
  if (!side) throw new MessagingError("NOT_FOUND", "Conversation not found."); // same as non-existent: no probing
  await db.conversationParticipant.upsert({ where: { conversationId_userId: { conversationId, userId: actor.id } }, update: {}, create: { conversationId, userId: actor.id, side } });
  return { conv, side };
}

/** Vendor workspaces where the actor may read and answer messages. */
export const messagingVendorIds = (actor: Actor) => actor.vendorIds.filter((v) => hasVendorCapability(actor.grants, v, "messages"));

// ─── Starting conversations ──────────────────────────────────────────────────

async function findOrCreate(customerId: string, vendorId: string, data: { subject: string; productId?: string | null; serviceId?: string | null; orderId?: string | null; bookingId?: string | null }) {
  return db.$transaction(async (tx) => {
    // Serialise creation per customer–vendor pair so two tabs can't create duplicates.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`conv:${customerId}:${vendorId}`}))`;
    const existing = await tx.conversation.findFirst({ where: { customerId, vendorId }, orderBy: { createdAt: "asc" } });
    if (existing) return existing;
    return tx.conversation.create({ data: { customerId, vendorId, ...data } });
  });
}

/** Customer → store. Before purchase (product/service/store) or after (order). */
export async function startAsCustomer(actor: Actor, input: { vendorId: string; productId?: string; serviceId?: string; orderNumber?: string }) {
  if (!actor.emailVerified) throw new MessagingError("FORBIDDEN", "Confirm your email address before messaging sellers.");
  const vendor = await db.vendor.findUnique({ where: { id: input.vendorId }, include: { store: true } });
  if (!vendor || vendor.status !== "APPROVED") throw new MessagingError("NOT_FOUND", "This store isn't available.");
  if (actor.vendorIds.includes(vendor.id) || vendor.ownerId === actor.id) throw new MessagingError("INVALID", "You can't message your own store.");
  let subject = vendor.store?.name ?? vendor.businessName;
  let productId: string | null = null, serviceId: string | null = null, orderId: string | null = null;
  if (input.productId) {
    const p = await db.product.findFirst({ where: { id: input.productId, vendorId: vendor.id, deletedAt: null } });
    if (!p) throw new MessagingError("INVALID", "That product isn't sold by this store.");
    productId = p.id; subject = p.name;
  }
  if (input.serviceId) {
    const s = await db.service.findFirst({ where: { id: input.serviceId, vendorId: vendor.id, deletedAt: null } });
    if (!s) throw new MessagingError("INVALID", "That service isn't offered by this provider.");
    serviceId = s.id; subject = s.title;
  }
  if (input.orderNumber) {
    const o = await db.order.findFirst({ where: { number: input.orderNumber, userId: actor.id, vendorOrders: { some: { vendorId: vendor.id } } } });
    if (!o) throw new MessagingError("INVALID", "That order isn't yours or doesn't include this store.");
    orderId = o.id; subject = `Order ${o.number}`;
  }
  const conv = await findOrCreate(actor.id, vendor.id, { subject, productId, serviceId, orderId });
  await db.conversationParticipant.upsert({ where: { conversationId_userId: { conversationId: conv.id, userId: actor.id } }, update: { archivedAt: null }, create: { conversationId: conv.id, userId: actor.id, side: "CUSTOMER" } });
  return { conversation: conv, ref: { productId, orderId } };
}

/** Store → customer: only about an order or booking that customer placed with this store. */
export async function startAsVendor(actor: Actor, vendorId: string, input: { vendorOrderId?: string; bookingId?: string }) {
  if (!hasVendorCapability(actor.grants, vendorId, "messages")) throw new MessagingError("FORBIDDEN", "You don't have access to this store's messages.");
  let customerId: string | null = null, orderId: string | null = null, bookingId: string | null = null, subject = "";
  if (input.vendorOrderId) {
    const vo = await db.vendorOrder.findFirst({ where: { id: input.vendorOrderId, vendorId }, include: { order: true } });
    if (!vo) throw new MessagingError("NOT_FOUND", "Order not found.");
    if (!vo.order.userId) throw new MessagingError("INVALID", "This was a guest checkout; the buyer has no account to message.");
    customerId = vo.order.userId; orderId = vo.orderId; subject = `Order ${vo.order.number}`;
  } else if (input.bookingId) {
    const b = await db.booking.findFirst({ where: { id: input.bookingId, vendorId }, include: { service: true } });
    if (!b) throw new MessagingError("NOT_FOUND", "Booking not found.");
    customerId = b.customerId; bookingId = b.id; subject = `Booking ${b.number}`;
  } else throw new MessagingError("INVALID", "Choose an order or booking.");
  const conv = await findOrCreate(customerId!, vendorId, { subject, orderId, bookingId });
  await db.conversationParticipant.upsert({ where: { conversationId_userId: { conversationId: conv.id, userId: actor.id } }, update: { archivedAt: null }, create: { conversationId: conv.id, userId: actor.id, side: "VENDOR" } });
  return { conversation: conv, ref: { orderId } };
}

// ─── Moderation helpers ──────────────────────────────────────────────────────

let rulesCache: { at: number; rules: RuleSet } | null = null;
export async function loadRules(): Promise<RuleSet> {
  if (rulesCache && Date.now() - rulesCache.at < 30_000) return rulesCache.rules;
  const rows = await db.moderationRule.findMany({ where: { enabled: true } });
  const rules: RuleSet = {
    blockTerms: rows.filter((r) => r.kind === "BLOCK_TERM").map((r) => r.value),
    reviewTerms: rows.filter((r) => r.kind === "REVIEW_TERM").map((r) => r.value),
    allowDomains: rows.filter((r) => r.kind === "ALLOW_DOMAIN").map((r) => r.value.toLowerCase()),
    disabled: rows.filter((r) => r.kind === "DETECTOR_OFF").map((r) => r.value as Category),
  };
  rulesCache = { at: Date.now(), rules };
  return rules;
}
export const clearRulesCache = () => { rulesCache = null; };

export function ownHosts() {
  const hosts = new Set(["xavierconnect.vercel.app"]);
  try { if (process.env.APP_URL) hosts.add(new URL(process.env.APP_URL).hostname.replace(/^www\./, "")); } catch { /* ignore */ }
  return [...hosts];
}

export async function activeMute(userId: string) {
  return db.userMessagingRestriction.findFirst({ where: { userId, kind: "MUTE", liftedAt: null, startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, orderBy: { endsAt: "desc" } });
}

/**
 * Progressive enforcement, driven by *confirmed* violations in the configured window:
 * first → warning; ≥ msgRestrictAfter → temporary mute; ≥ msgReviewAfter → flagged for staff review.
 * Never suspends an account — that is an authorised staff decision.
 */
export async function applyEnforcement(userId: string) {
  const [windowDays, restrictAfter, restrictHours, reviewAfter] = await Promise.all([
    getSetting(db, "msgViolationWindowDays"), getSetting(db, "msgRestrictAfter"), getSetting(db, "msgRestrictHours"), getSetting(db, "msgReviewAfter"),
  ]);
  const since = new Date(Date.now() - windowDays * 864e5);
  const count = await db.moderationEvent.count({ where: { userId, confirmed: true, createdAt: { gte: since } } });
  let notice: string | null = null;
  if (count === 1) {
    await db.userMessagingRestriction.create({ data: { userId, kind: "WARNING", reason: "First confirmed attempt to share contact details or arrange payment outside XavierConnect.", endsAt: new Date() } });
    notice = "This is a warning. Repeated attempts will pause your messaging.";
  }
  if (count >= restrictAfter && !(await activeMute(userId))) {
    const endsAt = new Date(Date.now() + restrictHours * 3600_000);
    await db.userMessagingRestriction.create({ data: { userId, kind: "MUTE", reason: `${count} confirmed violations in ${windowDays} days`, endsAt } });
    notice = `Messaging is paused until ${endsAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })} because of repeated violations.`;
  }
  if (count >= reviewAfter) {
    const flagged = await db.userMessagingRestriction.findFirst({ where: { userId, kind: "REVIEW_FLAG", liftedAt: null, createdAt: { gte: since } } });
    if (!flagged) {
      await db.userMessagingRestriction.create({ data: { userId, kind: "REVIEW_FLAG", reason: `${count} confirmed violations in ${windowDays} days` } });
      await raiseAlert({ dedupeKey: `msg-review:${userId}`, type: "MESSAGING_ABUSE", severity: "WARNING", title: "Repeated messaging violations need review", detail: `${count} confirmed violations in ${windowDays} days`, link: `/admin/communication/moderation?tab=users&user=${userId}` });
    }
  }
  return { count, notice };
}

const findingDetail = (f: Pick<Finding, "category" | "hint">[]) => f.map((x) => ({ category: x.category, hint: x.hint }));

// ─── Sending ─────────────────────────────────────────────────────────────────

export interface IncomingFile { name: string; type: string; bytes: Buffer }
export type SendResult =
  | { status: "DELIVERED" | "HELD"; message: MessageDTO; notice?: string | null; attachmentNotice?: string }
  | { status: "BLOCKED"; warning: string; notice?: string | null };

const sendTimes = new Map<string, number[]>();
function rateLimited(userId: string) {
  const now = Date.now();
  const arr = (sendTimes.get(userId) ?? []).filter((t) => now - t < 60_000);
  arr.push(now); sendTimes.set(userId, arr);
  return arr.length > 30;
}

export async function sendMessage(actor: Actor, conversationId: string, input: { body: string; productId?: string | null; orderId?: string | null; files?: IncomingFile[]; side?: Side }): Promise<SendResult> {
  const { conv, side } = await authorize(actor, conversationId, input.side);
  const mute = await activeMute(actor.id);
  if (mute) throw new MessagingError("RESTRICTED", mute.endsAt ? `Your messaging is paused until ${mute.endsAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}.` : "Your messaging has been paused by our moderation team. Contact support.");
  if (conv.blockedByCustomerAt || conv.blockedByVendorAt) {
    const mine = (side === "CUSTOMER" && conv.blockedByCustomerAt) || (side === "VENDOR" && conv.blockedByVendorAt);
    throw new MessagingError("BLOCKED_CONVERSATION", mine ? "You blocked this conversation. Unblock it to send messages." : "You can't send messages in this conversation.");
  }
  if (rateLimited(actor.id)) throw new MessagingError("RATE_LIMITED", "You're sending messages too quickly. Wait a minute.");
  const body = (input.body ?? "").replace(/\r\n/g, "\n").trim();
  const files = input.files ?? [];
  if (!body && !files.length) throw new MessagingError("INVALID", "Write a message or attach a file.");
  if (body.length > MAX_BODY) throw new MessagingError("INVALID", `Messages can be up to ${MAX_BODY} characters.`);
  if (files.length > MAX_FILES) throw new MessagingError("INVALID", `Attach up to ${MAX_FILES} files per message.`);
  for (const f of files) { try { validateAttachment(f.type, f.bytes); } catch (e) { if (e instanceof AttachmentError) throw new MessagingError("INVALID", `${f.name}: ${e.message}`); throw e; } }

  // References must belong to this conversation's store / customer.
  let productId: string | null = null, orderId: string | null = null;
  if (input.productId) {
    const p = await db.product.findFirst({ where: { id: input.productId, vendorId: conv.vendorId } });
    if (!p) throw new MessagingError("INVALID", "That product isn't from this store.");
    productId = p.id;
  }
  if (input.orderId) {
    const o = await db.order.findFirst({ where: { id: input.orderId, userId: conv.customerId, vendorOrders: { some: { vendorId: conv.vendorId } } } });
    if (!o) throw new MessagingError("INVALID", "That order isn't part of this conversation.");
    orderId = o.id;
  }

  // 1–5: normalise and run the text detectors.
  const rules = await loadRules();
  const text = body ? moderateText(body, { rules, ownHosts: ownHosts() }) : { decision: "APPROVED" as const, findings: [] };

  // BLOCKED: store for audit (never delivered), count a confirmed violation, tell only the sender.
  if (text.decision === "BLOCKED") {
    const m = await db.message.create({ data: { conversationId, senderId: actor.id, senderSide: side, body, status: "BLOCKED", moderation: "BLOCKED", productId, orderId } });
    await db.moderationEvent.create({ data: { userId: actor.id, conversationId, messageId: m.id, decision: "BLOCKED", categories: [...new Set(text.findings.map((f) => f.category))], detail: findingDetail(text.findings), confirmed: true } });
    const { notice } = await applyEnforcement(actor.id);
    return { status: "BLOCKED", warning: SENDER_BLOCK_MESSAGE, notice };
  }

  // 6: inspect attachments before anything is stored where a recipient could reach it.
  const inspections: { f: IncomingFile; r: Inspection }[] = [];
  for (const f of files) inspections.push({ f, r: await inspectAttachment(f.type, f.bytes, { rules, ownHosts: ownHosts() }) });

  // 7: decide.
  const held = text.decision === "REVIEW";
  const anyBlockedFile = inspections.some((i) => i.r.status === "BLOCKED");
  const now = new Date();
  const message = await db.message.create({
    data: {
      conversationId, senderId: actor.id, senderSide: side, body, productId, orderId,
      status: held ? "HELD" : "DELIVERED", deliveredAt: held ? null : now,
      moderation: held ? "REVIEW" : anyBlockedFile ? "ATTACHMENT_BLOCKED" : "APPROVED",
    },
  });
  for (const { f, r } of inspections) {
    const ext = r.mimeType === "image/png" ? "png" : r.mimeType === "image/jpeg" ? "jpg" : r.mimeType === "image/webp" ? "webp" : "pdf";
    // Blocked files are not kept at all; approved/held files go to private storage only.
    const storageKey = r.status === "BLOCKED" ? null : await savePrivateBytes(`messages/${conversationId}`, ext, r.output);
    const att = await db.messageAttachment.create({
      data: { messageId: message.id, uploaderId: actor.id, storageKey, fileName: f.name.replace(/[^\w.\- ]/g, "_").slice(0, 120) || `attachment.${ext}`, mimeType: r.mimeType, size: r.output.length, sha256: createHash("sha256").update(f.bytes).digest("hex"), status: r.status, findings: findingDetail(r.findings as Finding[]), scanner: r.scanner, scannedAt: now },
    });
    if (r.status !== "APPROVED") {
      await db.moderationEvent.create({ data: { userId: actor.id, conversationId, messageId: message.id, attachmentId: att.id, decision: r.status === "BLOCKED" ? "ATTACHMENT_BLOCKED" : "REVIEW", categories: [...new Set(r.findings.map((x) => x.category))], detail: findingDetail(r.findings as Finding[]), confirmed: r.status === "BLOCKED" && r.findings.some((x) => x.category !== "MALWARE") } });
    }
  }
  if (held) await db.moderationEvent.create({ data: { userId: actor.id, conversationId, messageId: message.id, decision: "REVIEW", categories: [...new Set(text.findings.map((f) => f.category))], detail: findingDetail(text.findings) } });
  const enforcement = anyBlockedFile ? await applyEnforcement(actor.id) : null;

  // 8: deliver.
  if (!held) await afterDelivery(conv, side, actor, message.id);
  await db.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: actor.id } }, data: { typingUntil: null, archivedAt: null, lastReadAt: now } });
  const dto = (await loadMessages(actor, conversationId, side, { ids: [message.id] }))[0];
  return {
    status: held ? "HELD" : "DELIVERED", message: dto, notice: enforcement?.notice,
    attachmentNotice: anyBlockedFile ? "An attachment was not sent because it appears to contain contact details, a QR code or other content that can't be shared." : inspections.some((i) => i.r.status === "REVIEW") ? "Your attachment will be visible to the other person after a quick safety check." : undefined,
  };
}

/** Bookkeeping when a message becomes visible to the recipient (on send, or on moderator approval). */
export async function afterDelivery(conv: { id: string; customerId: string; vendorId: string; subject: string }, senderSide: Side, sender: { id: string; name: string }, messageId: string) {
  await db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
  await db.conversationParticipant.updateMany({ where: { conversationId: conv.id }, data: { archivedAt: null } });
  // Notify the other side once per conversation until they read it. No message content in notifications.
  const recipients: { userId: string; link: string }[] = [];
  if (senderSide === "VENDOR") recipients.push({ userId: conv.customerId, link: `/account/messages/${conv.id}` });
  else {
    const members = await db.userRole.findMany({ where: { vendorId: conv.vendorId, role: { key: { in: ["VENDOR", "SERVICE_PROVIDER", "VENDOR_STAFF"] } } }, select: { userId: true } });
    for (const m of new Set(members.map((x) => x.userId))) recipients.push({ userId: m, link: `/vendor/messages/${conv.id}` });
  }
  for (const r of recipients) {
    if (r.userId === sender.id) continue;
    const existing = await db.messageNotification.findUnique({ where: { conversationId_userId: { conversationId: conv.id, userId: r.userId } } });
    if (existing) { await db.messageNotification.update({ where: { id: existing.id }, data: { lastMessageId: messageId } }); continue; }
    await db.messageNotification.create({ data: { conversationId: conv.id, userId: r.userId, lastMessageId: messageId } });
    await notify(db, { userId: r.userId, type: "message.new", title: `New message${senderSide === "VENDOR" ? "" : ` from ${sender.name}`}`, body: `About: ${conv.subject}. Open XavierConnect to read and reply.`, link: r.link });
  }
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface MessageDTO {
  id: string; mine: boolean; body: string; status: "DELIVERED" | "HELD"; senderName: string; senderSide: string;
  createdAt: string; deliveredAt: string | null; read: boolean;
  product: { id: string; name: string; slug: string; image: string | null; priceMinor: string } | null;
  order: { number: string } | null;
  attachments: { id: string; fileName: string; mimeType: string; status: string; url: string | null }[];
}

/** Messages the actor may see: everything DELIVERED, plus their own HELD messages. Never BLOCKED. */
export async function loadMessages(actor: Actor, conversationId: string, side: Side, opts: { ids?: string[]; before?: Date; afterDelivered?: Date; take?: number } = {}): Promise<MessageDTO[]> {
  const rows = await db.message.findMany({
    where: {
      conversationId,
      ...(opts.ids ? { id: { in: opts.ids } } : {}),
      OR: [{ status: "DELIVERED" }, { status: "HELD", senderId: actor.id }],
      ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
      ...(opts.afterDelivered ? { deliveredAt: { gt: opts.afterDelivered } } : {}),
    },
    orderBy: { createdAt: opts.afterDelivered ? "asc" : "desc" },
    take: opts.take ?? 60,
    include: { sender: { select: { name: true } }, attachments: true },
  });
  if (!opts.afterDelivered) rows.reverse();
  const other = await db.conversationParticipant.findMany({ where: { conversationId, side: side === "CUSTOMER" ? "VENDOR" : "CUSTOMER" }, select: { lastReadAt: true } });
  const otherRead = other.reduce<Date | null>((a, p) => (p.lastReadAt && (!a || p.lastReadAt > a) ? p.lastReadAt : a), null);
  const productIds = [...new Set(rows.map((r) => r.productId).filter(Boolean))] as string[];
  const orderIds = [...new Set(rows.map((r) => r.orderId).filter(Boolean))] as string[];
  const [products, orders, store] = await Promise.all([
    productIds.length ? db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, slug: true, priceMinor: true, salePriceMinor: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } } }) : [],
    orderIds.length ? db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true } }) : [],
    db.conversation.findUnique({ where: { id: conversationId }, select: { vendor: { select: { businessName: true, store: { select: { name: true } } } } } }),
  ]);
  return rows.map((m) => {
    const mine = m.senderId === actor.id || (m.senderSide === side && side === "VENDOR");
    const p = products.find((x) => x.id === m.productId);
    return {
      id: m.id, mine, body: m.body, status: m.status as "DELIVERED" | "HELD",
      senderName: m.senderSide === "VENDOR" ? (store?.vendor.store?.name ?? store?.vendor.businessName ?? "Store") : m.sender.name,
      senderSide: m.senderSide, createdAt: m.createdAt.toISOString(), deliveredAt: m.deliveredAt?.toISOString() ?? null,
      read: !!(mine && m.deliveredAt && otherRead && otherRead >= m.deliveredAt),
      product: p ? { id: p.id, name: p.name, slug: p.slug, image: p.images[0]?.url ?? null, priceMinor: (p.salePriceMinor ?? p.priceMinor).toString() } : null,
      order: m.orderId ? { number: orders.find((o) => o.id === m.orderId)?.number ?? "" } : null,
      attachments: m.attachments.map((a) => {
        const visible = a.status === "APPROVED" || (m.senderId === actor.id && a.status !== "BLOCKED");
        return { id: a.id, fileName: a.fileName, mimeType: a.mimeType, status: a.status, url: visible && a.storageKey ? `/messages/attachment/${a.id}` : null };
      }).filter((a) => a.status === "APPROVED" || m.senderId === actor.id), // recipients never learn about non-approved files
    };
  });
}

export async function markRead(actor: Actor, conversationId: string, side?: Side) {
  const { side: s } = await authorize(actor, conversationId, side);
  const now = new Date();
  const unread = await db.message.findMany({ where: { conversationId, status: "DELIVERED", senderSide: s === "CUSTOMER" ? "VENDOR" : "CUSTOMER", receipts: { none: { userId: actor.id } } }, select: { id: true }, take: 500 });
  if (unread.length) await db.messageReadReceipt.createMany({ data: unread.map((m) => ({ messageId: m.id, userId: actor.id, readAt: now })), skipDuplicates: true });
  await db.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: actor.id } }, data: { lastReadAt: now } });
  await db.messageNotification.deleteMany({ where: { conversationId, userId: actor.id } });
}

export async function setTyping(actor: Actor, conversationId: string, side?: Side) {
  await authorize(actor, conversationId, side);
  await db.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: actor.id } }, data: { typingUntil: new Date(Date.now() + 6000) } });
}

export async function touchPresence(userId: string) {
  await db.user.updateMany({ where: { id: userId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(Date.now() - 30_000) } }] }, data: { lastSeenAt: new Date() } });
}

/** Unread = delivered messages from the other side newer than my last read, per side. */
export async function unreadCounts(actor: Actor) {
  const vendorIds = messagingVendorIds(actor);
  const parts = await db.conversationParticipant.findMany({ where: { userId: actor.id }, select: { conversationId: true, lastReadAt: true, side: true } });
  const readMap = new Map(parts.map((p) => [`${p.conversationId}:${p.side}`, p.lastReadAt]));
  const rows = await db.message.groupBy({
    by: ["conversationId", "senderSide"],
    where: { status: "DELIVERED", senderId: { not: actor.id }, conversation: { OR: [{ customerId: actor.id }, ...(vendorIds.length ? [{ vendorId: { in: vendorIds } }] : [])] } },
    _max: { deliveredAt: true },
  });
  // Exact counts only for conversations that have something newer than the read marker.
  let customer = 0, vendor = 0;
  const per: Record<string, number> = {};
  for (const r of rows) {
    const mySide = r.senderSide === "VENDOR" ? "CUSTOMER" : "VENDOR";
    const last = readMap.get(`${r.conversationId}:${mySide}`) ?? null;
    if (last && r._max.deliveredAt && r._max.deliveredAt <= last) continue;
    const n = await db.message.count({ where: { conversationId: r.conversationId, status: "DELIVERED", senderSide: r.senderSide, senderId: { not: actor.id }, ...(last ? { deliveredAt: { gt: last } } : {}) } });
    if (!n) continue;
    per[`${r.conversationId}:${mySide}`] = n;
    if (mySide === "CUSTOMER") customer += n; else vendor += n;
  }
  return { customer, vendor, per };
}

export async function listConversations(actor: Actor, side: Side, opts: { q?: string; archived?: boolean; vendorId?: string } = {}) {
  const vendorIds = side === "VENDOR" ? (opts.vendorId ? [opts.vendorId].filter((v) => messagingVendorIds(actor).includes(v)) : messagingVendorIds(actor)) : [];
  if (side === "VENDOR" && !vendorIds.length) return [];
  const q = opts.q?.trim();
  const convs = await db.conversation.findMany({
    where: {
      ...(side === "CUSTOMER" ? { customerId: actor.id } : { vendorId: { in: vendorIds } }),
      // Only conversations that have at least one visible message, or that this user started.
      OR: [{ messages: { some: { OR: [{ status: "DELIVERED" }, { senderId: actor.id }] } } }, { participants: { some: { userId: actor.id } } }],
      ...(q ? { AND: [{ OR: [
        { subject: { contains: q, mode: "insensitive" } },
        side === "CUSTOMER" ? { vendor: { OR: [{ businessName: { contains: q, mode: "insensitive" } }, { store: { name: { contains: q, mode: "insensitive" } } }] } } : { customer: { name: { contains: q, mode: "insensitive" } } },
        { messages: { some: { status: "DELIVERED", body: { contains: q, mode: "insensitive" } } } },
      ] }] } : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    include: {
      vendor: { select: { businessName: true, store: { select: { name: true, logoUrl: true } } } },
      customer: { select: { name: true } },
      participants: { where: { userId: actor.id }, select: { archivedAt: true } },
      messages: { where: { OR: [{ status: "DELIVERED" }, { status: "HELD", senderId: actor.id }] }, orderBy: { createdAt: "desc" }, take: 1, select: { body: true, senderId: true, createdAt: true, attachments: { select: { id: true } } } },
    },
  });
  const unread = await unreadCounts(actor);
  return convs
    .filter((c) => (opts.archived ? !!c.participants[0]?.archivedAt : !c.participants[0]?.archivedAt))
    .map((c) => ({
      id: c.id, subject: c.subject,
      title: side === "CUSTOMER" ? (c.vendor.store?.name ?? c.vendor.businessName) : c.customer.name,
      avatar: side === "CUSTOMER" ? c.vendor.store?.logoUrl ?? null : null,
      last: c.messages[0] ? { body: c.messages[0].body || (c.messages[0].attachments.length ? "Attachment" : ""), mine: c.messages[0].senderId === actor.id, at: c.messages[0].createdAt.toISOString() } : null,
      unread: unread.per[`${c.id}:${side}`] ?? 0,
      blocked: !!(c.blockedByCustomerAt || c.blockedByVendorAt),
    }));
}

/** Everything a live chat panel needs since `after` (used by the event stream). */
export async function syncState(actor: Actor, conversationId: string, side: Side, after: Date) {
  const { conv } = await authorize(actor, conversationId, side);
  const fresh = await loadMessages(actor, conversationId, side, { afterDelivered: after, take: 100 });
  // Attachments approved by a moderator since `after` → resend those messages so the file appears.
  const reviewed = await db.messageAttachment.findMany({ where: { message: { conversationId, status: "DELIVERED" }, reviewedAt: { gt: after } }, select: { messageId: true } });
  const updated = reviewed.length ? await loadMessages(actor, conversationId, side, { ids: [...new Set(reviewed.map((r) => r.messageId))] }) : [];
  const others = await db.conversationParticipant.findMany({ where: { conversationId, side: side === "CUSTOMER" ? "VENDOR" : "CUSTOMER" }, include: { user: { select: { lastSeenAt: true } } } });
  const now = Date.now();
  const lastRead = others.reduce<Date | null>((a, p) => (p.lastReadAt && (!a || p.lastReadAt > a) ? p.lastReadAt : a), null);
  const typing = others.some((p) => p.typingUntil && p.typingUntil.getTime() > now);
  // Presence: store side shows "online" if any of its team is active; customers' presence is shown to the store only.
  const online = others.some((p) => p.user.lastSeenAt && now - p.user.lastSeenAt.getTime() < ONLINE_MS);
  return { messages: [...fresh, ...updated.filter((u) => !fresh.some((f) => f.id === u.id))], otherLastReadAt: lastRead?.toISOString() ?? null, typing, online, blocked: !!(conv.blockedByCustomerAt || conv.blockedByVendorAt) };
}

// ─── Conversation actions ────────────────────────────────────────────────────

export async function setArchived(actor: Actor, conversationId: string, archived: boolean, side?: Side) {
  await authorize(actor, conversationId, side);
  await db.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: actor.id } }, data: { archivedAt: archived ? new Date() : null } });
}

export async function setBlocked(actor: Actor, conversationId: string, blocked: boolean, side?: Side) {
  const { side: s } = await authorize(actor, conversationId, side);
  await db.conversation.update({ where: { id: conversationId }, data: s === "CUSTOMER" ? { blockedByCustomerAt: blocked ? new Date() : null } : { blockedByVendorAt: blocked ? new Date() : null } });
  await audit(db, { actorId: actor.id, action: blocked ? "conversation.block" : "conversation.unblock", entityType: "Conversation", entityId: conversationId, after: { side: s } });
}

export const REPORT_REASONS = ["Asked to pay or talk outside XavierConnect", "Scam or fraud", "Harassment or abuse", "Spam", "Counterfeit or prohibited item", "Other"] as const;

export async function reportConversation(actor: Actor, conversationId: string, input: { reason: string; details?: string; messageId?: string; side?: Side }) {
  await authorize(actor, conversationId, input.side);
  if (!(REPORT_REASONS as readonly string[]).includes(input.reason)) throw new MessagingError("INVALID", "Choose a reason.");
  if (input.messageId && !(await db.message.findFirst({ where: { id: input.messageId, conversationId, status: "DELIVERED" } }))) throw new MessagingError("INVALID", "Message not found.");
  const open = await db.messageReport.findFirst({ where: { conversationId, reporterId: actor.id, status: "OPEN" } });
  if (open) throw new MessagingError("INVALID", "You already have an open report for this conversation. Our team will review it.");
  const r = await db.messageReport.create({ data: { conversationId, reporterId: actor.id, reason: input.reason, details: input.details?.trim().slice(0, 1000) || null, messageId: input.messageId ?? null } });
  await audit(db, { actorId: actor.id, action: "conversation.report", entityType: "Conversation", entityId: conversationId, after: { reason: input.reason } });
  return r;
}

export { EMPTY_RULES };
