/**
 * Browser end-to-end test: messaging, moderation, admin moderation centre and Google sign-in.
 * Acceptance tests 1–20 (UI level). Needs a running server started with:
 *   GOOGLE_CLIENT_ID=e2e-client GOOGLE_CLIENT_SECRET=e2e-secret GOOGLE_OIDC_DISCOVERY_URL=http://127.0.0.1:4555/.well-known/openid-configuration
 *   GOOGLE_REDIRECT_URI=$BASE/auth/google/callback
 * and the seeded demo catalogue. Starts its own mock OpenID provider on :4555.
 * Usage: BASE=http://localhost:3100 IMG_DIR=/tmp node tests/e2e/messaging.e2e.cjs
 */
const { chromium, devices } = require("playwright");
const { PrismaClient } = require("@prisma/client");
const assert = require("node:assert/strict");
const path = require("node:path");

const BASE = process.env.BASE ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? "/tmp";
const db = new PrismaClient();
const run = Date.now().toString(36);
const step = (s) => console.log(`✓ ${s}`);
const BLOCK_TEXT = "Your message may contain contact information or an external payment request that cannot be shared through XavierConnect. Please edit your message and continue your conversation here.";

let adminTotpSecret = null;
function totp(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = require("node:crypto").createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function login(page, email, password) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email); await page.fill("#password", password);
  await page.click('main form button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function googleLogin(page, mock, user, next = "/account") {
  mock.setUser(user);
  await page.context().clearCookies();
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.click('[data-testid="google-signin"]');
  await page.waitForURL((u) => u.origin === new URL(BASE).origin && !u.pathname.startsWith("/login") && !u.pathname.startsWith("/auth"));
}

async function sendText(page, text) {
  await page.fill('textarea[aria-label="Message"]', text);
  await page.click('button[aria-label="Send message"]');
}

(async () => {
  const { startMockOidc } = await import(path.join(__dirname, "..", "mock-oidc.mjs"));
  const mock = await startMockOidc({ clientId: "e2e-client", clientSecret: "e2e-secret", port: 4555 });
  // Test database only: earlier runs leave the demo vendor with confirmed violations (the flagged-image
  // step), which would trip progressive enforcement. Start each run from a clean record.
  const demo = await db.user.findUniqueOrThrow({ where: { email: "studio-nine@demo.xavierconnect.local" } });
  await db.userMessagingRestriction.deleteMany({ where: { userId: demo.id } });
  await db.moderationEvent.updateMany({ where: { userId: demo.id }, data: { confirmed: false } });
  const browser = await chromium.launch();
  const errors = [];
  const mkPage = async (opts = {}) => { const ctx = await browser.newContext(opts); const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); return p; };
  const buyer = await mkPage({ viewport: { width: 1280, height: 860 } });
  const seller = await mkPage({ viewport: { width: 1280, height: 860 } });
  try {
    // ── Test 16: Google sign-in creates a customer account ──
    const gEmail = `buyer.${run}@gmail.com`;
    await googleLogin(buyer, mock, { sub: `g-${run}`, email: gEmail, email_verified: true, name: "Google Buyer" });
    const gUser = await db.user.findUniqueOrThrow({ where: { email: gEmail }, include: { roles: { include: { role: true } } } });
    assert.deepEqual(gUser.roles.map((r) => r.role.key), ["CUSTOMER"]);
    step("16: Continue with Google signed a new customer in (PKCE, state, nonce, signed ID token)");

    // ── Test 18: signing in again doesn't create a duplicate ──
    await googleLogin(buyer, mock, { sub: `g-${run}`, email: gEmail, email_verified: true, name: "Google Buyer" });
    assert.equal(await db.user.count({ where: { email: gEmail } }), 1);
    assert.equal(await db.externalIdentityAccount.count({ where: { subject: `g-${run}` } }), 1);
    step("18: second Google sign-in reused the same account (no duplicate)");

    // ── Test 19: Google sign-in doesn't open the seller dashboard ──
    await buyer.goto(`${BASE}/vendor`);
    assert.match(new URL(buyer.url()).pathname, /^\/sell/);
    step("19: Google user has no vendor access until a vendor application is approved");

    // ── Test 17: email + password still works ──
    await login(seller, "studio-nine@demo.xavierconnect.local", "Demo-Vendor-2026!");
    assert.ok(!new URL(seller.url()).pathname.startsWith("/login"));
    step("17: email/password sign-in still works (demo vendor)");

    // ── Test 1: customer starts a conversation from a product page ──
    const vendor = await db.vendor.findFirstOrThrow({ where: { owner: { email: "studio-nine@demo.xavierconnect.local" } }, include: { products: { where: { status: "PUBLISHED" }, take: 1 } } });
    const product = vendor.products[0];
    await buyer.goto(`${BASE}/p/${product.slug}`);
    await buyer.click('[data-testid="message-seller"]');
    await buyer.waitForURL(/\/account\/messages\/\w+/);
    const convId = new URL(buyer.url()).pathname.split("/").pop();
    await buyer.getByText(`About: ${product.name}`).first().waitFor();
    await sendText(buyer, "Hello, is this available in size 12? When can you deliver to Lekki?");
    await buyer.getByText("Hello, is this available in size 12?").first().waitFor();
    step("1: customer messaged the seller from the product page (product reference attached)");

    // ── Tests 2 & 5: vendor sees it, replies; both sides update in real time ──
    await seller.goto(`${BASE}/vendor/messages/${convId}`);
    await seller.getByText("Hello, is this available in size 12?").first().waitFor();
    await seller.getByText(product.name).first().waitFor();
    await sendText(seller, "Yes, size 12 is in stock. Delivery to Lekki takes 2 days.");
    const t0 = Date.now();
    await buyer.getByText("Yes, size 12 is in stock.").first().waitFor({ timeout: 10_000 });
    step(`5: reply appeared in the customer's open chat without reloading (${Date.now() - t0} ms)`);
    await seller.fill('textarea[aria-label="Message"]', "Let me check the colours");
    await buyer.getByText("typing…").first().waitFor({ timeout: 10_000 });
    step("5: typing indicator shown live");
    await seller.fill('textarea[aria-label="Message"]', "");
    await sendText(buyer, "Great, thank you!");
    await seller.getByText("Great, thank you!").first().waitFor({ timeout: 10_000 });
    await buyer.getByText("Read").last().waitFor({ timeout: 10_000 });
    step("2: vendor replied; customer message reached vendor live and shows a read receipt");

    // ── Test 3: history after reload ──
    await buyer.reload();
    for (const t of ["Hello, is this available in size 12?", "Yes, size 12 is in stock.", "Great, thank you!"]) await buyer.getByText(t).first().waitFor();
    step("3: conversation history persists across reloads");

    // ── Tests 11 & 13: blocked content, warning, draft kept, never delivered ──
    await sendText(buyer, "Just call me on 0803 123 4567 or WhatsApp, we can pay directly");
    await buyer.getByText(BLOCK_TEXT).first().waitFor();
    assert.equal(await buyer.inputValue('textarea[aria-label="Message"]'), "Just call me on 0803 123 4567 or WhatsApp, we can pay directly");
    await seller.waitForTimeout(5000);
    assert.equal(await seller.getByText("0803 123 4567").count(), 0);
    await seller.reload();
    assert.equal(await seller.getByText("0803 123 4567").count(), 0);
    step("13: sender saw the exact warning and kept the draft to edit");
    step("11: blocked message never reached the vendor (live or after reload)");
    await buyer.fill('textarea[aria-label="Message"]', "Can you send a photo of the back?");
    await buyer.click('button[aria-label="Send message"]');
    await seller.getByText("Can you send a photo of the back?").first().waitFor({ timeout: 10_000 });
    step("13: edited message sent normally");

    // ── Test 12: flagged image never exposed ──
    const sharp = require("sharp");
    const svg = (t) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="220"><rect width="100%" height="100%" fill="white"/><text x="20" y="130" font-size="52" font-family="sans-serif">${t}</text></svg>`);
    const badPath = path.join(SHOTS, `bad-${run}.png`), goodPath = path.join(SHOTS, `good-${run}.png`);
    await sharp(svg("WhatsApp 0803 123 4567")).png().toFile(badPath);
    await sharp(svg("Back of the dress")).png().toFile(goodPath);
    await seller.setInputFiles('input[type="file"]', [badPath, goodPath]);
    await seller.fill('textarea[aria-label="Message"]', "Photos of the back");
    await seller.click('button[aria-label="Send message"]');
    await seller.getByText(/attachment was not sent/).first().waitFor({ timeout: 30_000 });
    await buyer.getByText("Photos of the back").first().waitFor({ timeout: 10_000 });
    await buyer.waitForTimeout(1500);
    const imgs = await buyer.locator('img[alt$=".png"]').evaluateAll((els) => els.map((e) => e.getAttribute("alt")));
    assert.deepEqual(imgs.filter((a) => a.startsWith("bad-")), []);
    assert.ok(imgs.some((a) => a.startsWith("good-")), "clean image should be visible");
    const badAtt = await db.messageAttachment.findFirstOrThrow({ where: { fileName: `bad-${run}.png` } });
    const direct = await buyer.request.get(`${BASE}/messages/attachment/${badAtt.id}`);
    assert.equal(direct.status(), 404);
    step("12: image with a phone number (OCR) blocked; clean image delivered; blocked file unreachable by URL");

    // ── Tests 4 & 6: another signed-in user cannot read or stream the conversation ──
    const intruder = await mkPage();
    await googleLogin(intruder, mock, { sub: `g-x-${run}`, email: `intruder.${run}@gmail.com`, email_verified: true, name: "Intruder" });
    const r1 = await intruder.goto(`${BASE}/account/messages/${convId}`);
    assert.equal(r1.status(), 404);
    const r2 = await intruder.request.get(`${BASE}/api/messages/${convId}/stream?side=CUSTOMER`);
    assert.equal(r2.status(), 404);
    const r3 = await intruder.request.post(`${BASE}/api/messages/${convId}/send`, { multipart: { body: "hi" }, headers: { Origin: BASE } });
    assert.equal(r3.status(), 404);
    const r4 = await intruder.request.get(`${BASE}/api/messages/${convId}/history?side=VENDOR`);
    assert.equal(r4.status(), 404);
    const r5 = await intruder.request.post(`${BASE}/api/messages/${convId}/send`, { multipart: { body: "hi" }, headers: { Origin: "https://evil.example" } });
    assert.equal(r5.status(), 403);
    step("4 & 6: non-participant gets 404 on page, stream, history and send; cross-origin POST refused");
    const r6 = await intruder.goto(`${BASE}/admin/communication/moderation`);
    assert.ok(!new URL(intruder.url()).pathname.startsWith("/admin/communication"), `customer reached ${intruder.url()} (${r6.status()})`);
    step("15: customers cannot open the moderation centre");

    // ── Test 15: admin inspects moderation events (with MFA) ──
    const admin = await mkPage({ viewport: { width: 1360, height: 900 } });
    await login(admin, "admin@xavierconnect.local", "ChangeMe-Admin-2026!");
    await admin.goto(`${BASE}/admin/communication/moderation?tab=audit`);
    if (new URL(admin.url()).pathname.startsWith("/mfa")) {
      const key = admin.locator("code.select-all");
      if (await key.count()) {
        adminTotpSecret = (await key.innerText()).replace(/\s/g, "");
        await admin.fill("#code", totp(adminTotpSecret)); await admin.click('button[type="submit"]');
        await admin.getByText(/recovery code/i).first().waitFor();
      } else throw new Error("admin already enrolled in MFA; reset it in the e2e database first");
      await admin.goto(`${BASE}/admin/communication/moderation?tab=audit`);
    }
    await admin.getByText("Moderation decisions").first().waitFor();
    assert.ok((await admin.locator("text=blocked").count()) > 0);
    assert.equal(await admin.getByText("0803 123 4567").count(), 0); // findings are redacted in the log
    await admin.goto(`${BASE}/admin/communication`);
    await admin.getByText("Messages blocked").first().waitFor();
    await admin.screenshot({ path: path.join(SHOTS, "admin-communication.png"), fullPage: true });
    // A report unlocks the transcript for moderators; the view is logged.
    await buyer.click('button[aria-label="Conversation options"]');
    await buyer.getByText("Report conversation").click();
    await buyer.getByLabel("Asked to pay or talk outside XavierConnect").check();
    await buyer.getByText("Send report").click();
    await buyer.getByText(/our team will review/).first().waitFor();
    const report = await db.messageReport.findFirstOrThrow({ where: { conversationId: convId, status: "OPEN" } });
    await admin.goto(`${BASE}/admin/communication/moderation?tab=reports&id=${report.id}`);
    await admin.getByText("This access has been logged").first().waitFor();
    await admin.getByText("Hello, is this available in size 12?").first().waitFor();
    await admin.screenshot({ path: path.join(SHOTS, "admin-moderation-report.png"), fullPage: true });
    assert.ok(await db.auditLog.count({ where: { action: "moderation.transcript.view", entityId: convId } }) >= 1);
    step("15: admin (with TOTP) saw redacted moderation events, stats, and a reported transcript — access audited");

    // ── Test 20: mobile ──
    const phone = await mkPage({ ...devices["iPhone 13"] });
    await googleLogin(phone, mock, { sub: `g-${run}`, email: gEmail, email_verified: true, name: "Google Buyer" });
    await phone.goto(`${BASE}/account/messages`);
    await phone.getByText("Studio Nine", { exact: false }).first().waitFor();
    await phone.screenshot({ path: path.join(SHOTS, "mobile-inbox.png") });
    await phone.goto(`${BASE}/account/messages/${convId}`);
    assert.equal(await phone.locator('aside[aria-label="Conversations"]').isVisible(), false);
    await sendText(phone, "Sent from my phone");
    await seller.getByText("Sent from my phone").first().waitFor({ timeout: 10_000 });
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
    await phone.screenshot({ path: path.join(SHOTS, "mobile-chat.png") });
    await seller.screenshot({ path: path.join(SHOTS, "vendor-chat.png") });
    await buyer.screenshot({ path: path.join(SHOTS, "customer-chat.png") });
    step("20: mobile inbox and chat work (single-pane, no horizontal scroll), message delivered live to desktop vendor");

    assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
    console.log("\nAll messaging browser checks passed.");
  } catch (e) {
    console.error("✗", e);
    await buyer.screenshot({ path: path.join(SHOTS, "fail-buyer.png") }).catch(() => {});
    await seller.screenshot({ path: path.join(SHOTS, "fail-seller.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close(); await mock.close(); await db.$disconnect();
  }
})();
