/**
 * Messaging and moderation against a real database. Covers acceptance tests 1–4, 6, 11–15
 * (real-time delivery and the UI are covered by the browser test).
 */
import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { db } from "@/server/db";
import { syncRbac } from "../../prisma/rbac-sync";
import { hashPassword } from "@/server/auth/password";
import {
  startAsCustomer, startAsVendor, sendMessage, loadMessages, listConversations, markRead, unreadCounts, syncState,
  setBlocked, reportConversation, MessagingError, type Actor,
} from "@/server/services/messaging";
import { approveHeld, rejectHeld, reviewAttachment, reportedTranscript, ModerationError } from "@/server/services/moderation-admin";
import { SENDER_BLOCK_MESSAGE } from "@/server/moderation/detect";

process.env.ENCRYPTION_KEY ??= "1".repeat(64);
let buyer: Actor, seller: Actor, stranger: Actor, otherSeller: Actor, admin: { id: string };
let vendorId: string, productId: string, convId: string;

async function mkUser(email: string, role: string, vendorId?: string): Promise<Actor> {
  const r = await db.role.findUniqueOrThrow({ where: { key: role } });
  const u = await db.user.create({ data: { email, name: email.split("@")[0], passwordHash: await hashPassword("Password123!"), emailVerifiedAt: new Date(), roles: { create: { roleId: r.id, vendorId } } } });
  return { id: u.id, name: u.name, emailVerified: true, grants: [{ role, vendorId: vendorId ?? null }], vendorIds: vendorId ? [vendorId] : [] };
}

beforeAll(async () => {
  await syncRbac(db);
  const cat = await db.category.create({ data: { slug: "msg-cat", name: "Msg", kind: "PRODUCT" } });
  const owner = await db.user.create({ data: { email: "msg-owner@test", name: "Owner", passwordHash: "x", emailVerifiedAt: new Date() } });
  const v = await db.vendor.create({ data: { ownerId: owner.id, type: "BUSINESS", status: "APPROVED", businessName: "Ada Fabrics", email: "s@test", phone: "08030000000", store: { create: { slug: "ada-fabrics", name: "Ada Fabrics" } } } });
  const v2 = await db.vendor.create({ data: { ownerId: owner.id, type: "BUSINESS", status: "APPROVED", businessName: "Other Store", email: "o@test", phone: "08030000001" } });
  vendorId = v.id;
  productId = (await db.product.create({ data: { vendorId: v.id, categoryId: cat.id, name: "Ankara wrap dress", slug: "ankara-wrap", description: "d", priceMinor: 1_500_000n, status: "PUBLISHED" } })).id;
  buyer = await mkUser("buyer@msg.test", "CUSTOMER");
  seller = await mkUser("seller@msg.test", "VENDOR", v.id);
  otherSeller = await mkUser("other@msg.test", "VENDOR", v2.id);
  stranger = await mkUser("stranger@msg.test", "CUSTOMER");
  admin = await db.user.create({ data: { email: "mod@msg.test", name: "Mod", passwordHash: "x" } });
});

describe("conversations and privacy", () => {
  it("Test 1: a customer starts a conversation from a product", async () => {
    const { conversation } = await startAsCustomer(buyer, { vendorId, productId });
    convId = conversation.id;
    const r = await sendMessage(buyer, convId, { body: "Hello, is the Ankara wrap dress available in size 12?", productId });
    expect(r.status).toBe("DELIVERED");
    expect((await loadMessages(buyer, convId, "CUSTOMER"))[0].read).toBe(false); // not read until the store opens it
    // Starting again reuses the same thread (no duplicates per customer–store pair).
    expect((await startAsCustomer(buyer, { vendorId })).conversation.id).toBe(convId);
  });
  it("Test 2: the vendor sees it, unread, and responds", async () => {
    expect((await unreadCounts(seller)).vendor).toBe(1);
    const list = await listConversations(seller, "VENDOR");
    expect(list.map((c) => c.id)).toContain(convId);
    const r = await sendMessage(seller, convId, { body: "Yes! We have size 12 in stock. Shall I reserve one?" });
    expect(r.status).toBe("DELIVERED");
  });
  it("Test 3: history, references and read receipts", async () => {
    const msgs = await loadMessages(buyer, convId, "CUSTOMER");
    expect(msgs.map((m) => m.body)).toEqual(["Hello, is the Ankara wrap dress available in size 12?", "Yes! We have size 12 in stock. Shall I reserve one?"]);
    expect(msgs[0].product?.name).toBe("Ankara wrap dress");
    // Replying (or opening the thread) marks it read for the store.
    await markRead(seller, convId);
    expect((await loadMessages(buyer, convId, "CUSTOMER"))[0].read).toBe(true);
    expect(await db.messageReadReceipt.count({ where: { userId: seller.id } })).toBeGreaterThan(0);
    expect((await unreadCounts(buyer)).customer).toBe(1);
    await markRead(buyer, convId);
    expect((await unreadCounts(buyer)).customer).toBe(0);
  });
  it("Tests 4 & 6: other users and other stores cannot read, send or even detect the conversation", async () => {
    for (const actor of [stranger, otherSeller]) {
      await expect(loadMessagesAuthorized(actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(sendMessage(actor, convId, { body: "hi" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(syncState(actor, convId, "CUSTOMER", new Date(0))).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await listConversations(actor, "CUSTOMER")).length + (await listConversations(actor, "VENDOR")).length).toBe(0);
    }
    await expect(sendMessage(buyer, "does-not-exist", { body: "hi" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("a vendor can only open a conversation about their own orders", async () => {
    await expect(startAsVendor(otherSeller, vendorId, { vendorOrderId: "x" })).rejects.toBeInstanceOf(MessagingError);
  });
  it("product references must belong to the store", async () => {
    const foreign = await db.product.create({ data: { vendorId: (await db.vendor.findFirstOrThrow({ where: { businessName: "Other Store" } })).id, categoryId: (await db.category.findFirstOrThrow({ where: { slug: "msg-cat" } })).id, name: "x", slug: "x-foreign", description: "d", priceMinor: 1n } });
    await expect(sendMessage(buyer, convId, { body: "this one?", productId: foreign.id })).rejects.toMatchObject({ code: "INVALID" });
  });
});

async function loadMessagesAuthorized(actor: Actor) {
  // The route always authorises first; mirror that here.
  return syncState(actor, convId, "VENDOR", new Date(0));
}

describe("moderation before delivery", () => {
  it("Tests 11 & 13: a blocked message never reaches the recipient and the sender is warned", async () => {
    const cursor = new Date();
    const r = await sendMessage(buyer, convId, { body: "just whatsapp me on 0803 123 4567 and pay directly" });
    expect(r).toMatchObject({ status: "BLOCKED", warning: SENDER_BLOCK_MESSAGE });
    const seen = await loadMessages(seller, convId, "VENDOR");
    expect(seen.some((m) => m.body.includes("0803"))).toBe(false);
    const after = await syncState(seller, convId, "VENDOR", new Date(Date.now() - 60_000));
    expect(after.messages.some((m) => m.body.includes("0803"))).toBe(false);
    expect((await unreadCounts(seller)).vendor).toBe(0);
    expect(await db.notification.count({ where: { type: "message.new", body: { contains: "0803" } } })).toBe(0);
    expect((await syncState(seller, convId, "VENDOR", cursor)).messages.length).toBe(0); // the live stream sends nothing
    // The sender doesn't see it in their history either (they edit and resend instead).
    expect((await loadMessages(buyer, convId, "CUSTOMER")).some((m) => m.body.includes("0803"))).toBe(false);
    // Audit trail exists with redacted findings only.
    const ev = await db.moderationEvent.findFirstOrThrow({ where: { userId: buyer.id, decision: "BLOCKED" }, orderBy: { createdAt: "desc" } });
    expect(ev.categories).toEqual(expect.arrayContaining(["PHONE"]));
    expect(JSON.stringify(ev.detail)).not.toContain("0803 123");
  });
  it("first confirmed violation gives a warning; repeated ones pause messaging; staff are alerted later", async () => {
    const r2 = await sendMessage(buyer, convId, { body: "email me: ada@gmail.com" });
    expect(r2.status).toBe("BLOCKED");
    const r3 = await sendMessage(buyer, convId, { body: "my IG is @ada.fabrics, chat me on instagram" });
    expect(r3).toMatchObject({ status: "BLOCKED" });
    expect((r3 as { notice?: string }).notice).toMatch(/paused/);
    await expect(sendMessage(buyer, convId, { body: "Is the dress still available?" })).rejects.toMatchObject({ code: "RESTRICTED" });
    expect(await db.user.findUniqueOrThrow({ where: { id: buyer.id } })).toMatchObject({ status: "ACTIVE" }); // never auto-suspended
    // Lift for the rest of the tests.
    await db.userMessagingRestriction.updateMany({ where: { userId: buyer.id, kind: "MUTE" }, data: { liftedAt: new Date() } });
  });
  it("ambiguous content is held for review, visible only to the sender until approved", async () => {
    const r = await sendMessage(buyer, convId, { body: "Do you accept PayPal?" });
    expect(r.status).toBe("HELD");
    expect((await loadMessages(seller, convId, "VENDOR")).some((m) => m.body.includes("PayPal"))).toBe(false);
    expect((await loadMessages(buyer, convId, "CUSTOMER")).find((m) => m.body.includes("PayPal"))?.status).toBe("HELD");
    const held = await db.message.findFirstOrThrow({ where: { status: "HELD" } });
    await approveHeld(admin.id, held.id, "Question only");
    expect((await loadMessages(seller, convId, "VENDOR")).some((m) => m.body.includes("PayPal"))).toBe(true);
    await expect(approveHeld(admin.id, held.id)).rejects.toBeInstanceOf(ModerationError);
    const r2 = await sendMessage(buyer, convId, { body: "Can I pay with crypto?" });
    expect(r2.status).toBe("HELD");
    await rejectHeld(admin.id, (await db.message.findFirstOrThrow({ where: { status: "HELD" } })).id, { violation: false, note: "declined" });
    expect((await loadMessages(seller, convId, "VENDOR")).some((m) => m.body.includes("crypto"))).toBe(false);
  });
  it("Test 12: a flagged image is never exposed to the recipient", async () => {
    const svg = (t: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="200"><rect width="100%" height="100%" fill="white"/><text x="20" y="120" font-size="48" font-family="sans-serif">${t}</text></svg>`);
    const bad = await sharp(svg("Call 0803 123 4567")).png().toBuffer();
    const good = await sharp(svg("Back view of the dress")).png().toBuffer();
    const r = await sendMessage(seller, convId, { body: "Here are the photos", files: [{ name: "a.png", type: "image/png", bytes: bad }, { name: "b.png", type: "image/png", bytes: good }] });
    expect(r.status).toBe("DELIVERED");
    expect((r as { attachmentNotice?: string }).attachmentNotice).toMatch(/not sent/);
    const seen = (await loadMessages(buyer, convId, "CUSTOMER")).find((m) => m.body === "Here are the photos")!;
    expect(seen.attachments.map((a) => a.fileName)).toEqual(["b.png"]);
    const blocked = await db.messageAttachment.findFirstOrThrow({ where: { fileName: "a.png" } });
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.storageKey).toBeNull(); // not even stored
  }, 60_000);
  it("PDFs wait for a moderator before the recipient can open them", async () => {
    const r = await sendMessage(seller, convId, { body: "Invoice attached", files: [{ name: "invoice.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.4\n%test\n") }] });
    expect(r.status).toBe("DELIVERED");
    expect((await loadMessages(buyer, convId, "CUSTOMER")).find((m) => m.body === "Invoice attached")!.attachments).toEqual([]);
    const att = await db.messageAttachment.findFirstOrThrow({ where: { fileName: "invoice.pdf" } });
    await reviewAttachment(admin.id, att.id, "APPROVED");
    expect((await loadMessages(buyer, convId, "CUSTOMER")).find((m) => m.body === "Invoice attached")!.attachments[0]).toMatchObject({ fileName: "invoice.pdf", url: `/messages/attachment/${att.id}` });
  });
  it("Test 14: everyday product questions go straight through", async () => {
    for (const body of ["How much is delivery to Lekki? The price shows ₦45,000.", "Can I order 3 pieces? My order number is XC-10001-A.", "Does this phone support WhatsApp and dual SIM?"]) {
      expect((await sendMessage(buyer, convId, { body })).status).toBe("DELIVERED");
    }
  });
});

describe("block and report", () => {
  it("blocking stops both sides from sending until unblocked", async () => {
    await setBlocked(buyer, convId, true);
    await expect(sendMessage(seller, convId, { body: "hello?" })).rejects.toMatchObject({ code: "BLOCKED_CONVERSATION" });
    await expect(sendMessage(buyer, convId, { body: "hello?" })).rejects.toMatchObject({ code: "BLOCKED_CONVERSATION" });
    await setBlocked(buyer, convId, false);
    expect((await sendMessage(seller, convId, { body: "Thanks for unblocking" })).status).toBe("DELIVERED");
  });
  it("Test 15: moderators can read a transcript only while it is reported, and the access is audited", async () => {
    await expect(reportedTranscript(admin.id, convId)).rejects.toBeInstanceOf(ModerationError);
    await reportConversation(buyer, convId, { reason: "Asked to pay or talk outside XavierConnect" });
    const t = await reportedTranscript(admin.id, convId);
    expect(t.messages.length).toBeGreaterThan(3);
    expect(await db.auditLog.count({ where: { action: "moderation.transcript.view", entityId: convId, actorId: admin.id } })).toBe(1);
  });
});
