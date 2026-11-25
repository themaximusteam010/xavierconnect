/**
 * Browser end-to-end test of acceptance workflows A, B, C, D, E, G and H against a running server.
 * Usage: BASE=http://localhost:3100 IMG=path/to/photo.png node tests/e2e/workflows.e2e.cjs
 * Requires the seeded demo catalogue and the seed admin account. Creates uniquely-named test users.
 */
const { chromium } = require("playwright");
const { PrismaClient } = require("@prisma/client");
const assert = require("node:assert/strict");

const BASE = process.env.BASE ?? "http://localhost:3100";
const IMG = process.env.IMG;
const db = new PrismaClient();
const run = Date.now().toString(36);
const step = (s) => console.log(`✓ ${s}`);

async function tokenFromEmail(to, kind) {
  const m = await db.emailOutbox.findFirst({ where: { to }, orderBy: { createdAt: "desc" } });
  const match = new RegExp(`${kind}\\?token=([\\w-]+)`).exec(m?.text ?? "");
  assert.ok(match, `no ${kind} email for ${to}`);
  return match[1];
}

async function register(page, name, email) {
  await page.goto(`${BASE}/register`);
  await page.fill("#name", name); await page.fill("#email", email); await page.fill("#password", "Password1234");
  await page.check('input[name="terms"]');
  await page.click('main button[type="submit"]');
  await page.waitForURL(/verify-email/);
  await page.goto(`${BASE}/verify-email?token=${await tokenFromEmail(email, "verify-email")}`);
  await page.getByText("Email confirmed").waitFor();
}

async function login(page, email, password) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email); await page.fill("#password", password);
  await page.click('main button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}


// RFC 6238 TOTP (SHA-1, 30 s, 6 digits) so the script can complete staff two-step verification.
let adminTotpSecret = process.env.ADMIN_TOTP_SECRET || null;
function totp(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = require("node:crypto").createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function adminLogin(page) {
  await login(page, process.env.ADMIN_EMAIL ?? "admin@xavierconnect.local", process.env.ADMIN_PASSWORD ?? "ChangeMe-Admin-2026!");
  await page.goto(`${BASE}/admin`);
  if (!new URL(page.url()).pathname.startsWith("/mfa")) return;
  const keyEl = page.locator("code.select-all");
  if (await keyEl.count()) {
    adminTotpSecret = (await keyEl.innerText()).replace(/\s/g, "");
    await page.fill("#code", totp(adminTotpSecret));
    await page.click('button[type="submit"]');
    await page.getByText(/recovery code/i).first().waitFor();
    step("staff MFA enrolled (TOTP)");
  } else {
    if (!adminTotpSecret) throw new Error("Admin already has MFA enrolled: set ADMIN_TOTP_SECRET to run the admin steps.");
    await page.fill("#code", totp(adminTotpSecret));
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/mfa"));
  }
  await page.goto(`${BASE}/admin`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  page.on("pageerror", (e) => { throw e; });

  // ── Workflow A: vendor registration through to approval ──
  const vEmail = `vendor-${run}@e2e.test`;
  await register(page, "E2E Vendor", vEmail);
  step("A: vendor account registered and email verified");
  await page.goto(`${BASE}/sell/apply?step=2`);
  await page.check('input[value="INDIVIDUAL"]'); await page.click('main button[type="submit"]');
  await page.waitForURL(/step=3/).catch(async (e) => { await page.screenshot({ path: process.env.SHOT ?? "/tmp/e2e-fail.png" }); console.log("URL", page.url()); throw e; });
  await page.fill("#businessName", `E2E Crafts ${run}`);
  await page.fill("#description", "Handmade leather goods produced in our Lagos workshop for everyday use.");
  await page.fill("#businessCategory", "Fashion");
  await page.fill("#phone", "08031234567");
  await page.fill("#addressLine1", "12 Workshop Road"); await page.fill("#city", "Yaba"); await page.selectOption("#state", "Lagos");
  await page.click('main button[type="submit"]'); await page.waitForURL(/step=4/);
  await page.setInputFiles("#file", IMG); await page.click('form:has(#file) button[type="submit"]'); await page.getByText("logo.png").waitFor();
  await page.goto(`${BASE}/sell/apply?step=5`);
  await page.fill("#name", `E2E Crafts ${run}`); await page.click('main button[type="submit"]'); await page.waitForURL(/step=6/);
  await page.fill('input[name="accountHolderName"]', "E2E Vendor"); await page.fill('input[name="bankName"]', "GTBank");
  await page.fill('input[name="bankCode"]', "058"); await page.fill('input[name="accountNumber"]', "0123456789"); await page.check('input[name="confirm"]');
  await page.click('form:has(input[name="accountNumber"]) button[type="submit"]'); await page.waitForURL(/step=7/);
  step("A: payout account submitted (pending finance verification for manual transfers)");
  await page.fill("#localRate", "2000"); await page.fill("#nationalRate", "4500"); await page.click('main button[type="submit"]'); await page.waitForURL(/step=8/);
  await page.check('input[name="agree"]'); await page.click('main button[type="submit"]'); await page.waitForURL(/submitted=1/);
  step("A: application completed through all steps and submitted");

  await adminLogin(page);
  const vendor = await db.vendor.findFirstOrThrow({ where: { email: vEmail } });
  await page.goto(`${BASE}/admin/vendors/${vendor.id}`);
  page.once("dialog", (d) => d.accept());
  await page.click('button[value="APPROVE"]'); await page.getByText("Decision recorded").waitFor();
  step("A: admin approved the vendor");

  // ── Workflow B: product listing and moderation ──
  await login(page, vEmail, "Password1234");
  await page.goto(`${BASE}/vendor`); await page.getByRole("heading", { name: "Overview" }).waitFor();
  step("A: approved vendor reached their dashboard");
  await page.goto(`${BASE}/vendor/products/new`);
  await page.fill("#name", `E2E Leather Wallet ${run}`);
  const fashionCat = await db.category.findUniqueOrThrow({ where: { slug: "fashion-bags-and-accessories" } });
  await page.selectOption("#categoryId", fashionCat.id);
  await page.fill("#description", "Full-grain leather bifold wallet, hand stitched with waxed thread.");
  await page.fill("#price", "15000"); await page.fill("#stockQuantity", "5"); await page.fill("#weightGrams", "150");
  await page.setInputFiles('input[name="images"]', IMG);
  await page.click('button[value="submit"]'); await page.getByText("Submitted for review").waitFor();
  const product = await db.product.findFirstOrThrow({ where: { vendorId: vendor.id }, include: { images: true } });
  assert.equal(product.status, "PENDING_REVIEW"); assert.equal(product.images.length, 1);
  step("B: vendor created product with photo and submitted it");
  const res = await page.request.get(`${BASE}${product.images[0].url}`); assert.equal(res.status(), 200);
  step("B: uploaded image is served from storage");

  await adminLogin(page);
  await page.goto(`${BASE}/admin/listings`);
  await page.locator(`li:has-text("E2E Leather Wallet ${run}") button[value="approve"]`).click();
  await page.getByText("Listing approved").waitFor();
  step("B: admin approved the listing; it is now public");

  // ── Workflows C + D + G: customer multi-vendor purchase incl. digital ──
  const cEmail = `buyer-${run}@e2e.test`;
  await page.context().clearCookies();
  await register(page, "E2E Buyer", cEmail);
  await page.goto(`${BASE}/shop?q=${encodeURIComponent("Leather Wallet " + run)}`);
  await page.click(`text=E2E Leather Wallet ${run}`); await page.waitForURL(/\/p\//);
  await page.click('button:has-text("Add to cart")'); await page.getByText("Added to your cart").waitFor();
  await page.goto(`${BASE}/p/suya-spice-yaji-250g-mama-put-pantry`);
  await page.click('button:has-text("Add to cart")'); await page.getByText("Added to your cart").waitFor();
  await page.goto(`${BASE}/p/social-media-content-planner-2027-studio-nine`);
  await page.click('button:has-text("Add to cart")'); await page.getByText("Added to your cart").waitFor();
  step("C: buyer searched, found and added products from 3 vendors");
  await page.goto(`${BASE}/cart`);
  assert.equal(await page.locator("section[aria-label^='Items from']").count(), 3);
  await page.goto(`${BASE}/checkout`);
  await page.fill("#fullName", "E2E Buyer"); await page.fill("#phone", "08039876543"); await page.fill("#line1", "5 Admiralty Way");
  await page.fill("#city", "Lekki"); await page.selectOption("#state", "Lagos");
  await page.click('button:has-text("Pay ")'); await page.waitForURL(/checkout\/sandbox/);
  await page.click('button[value="approve"]'); await page.waitForURL(/account\/orders\/XC-/);
  await page.getByText("Payment confirmed", { exact: true }).waitFor();
  const order = await db.order.findFirstOrThrow({ where: { user: { email: cEmail } }, include: { vendorOrders: true } });
  assert.equal(order.paymentStatus, "PAID"); assert.equal(order.vendorOrders.length, 3);
  step(`D: one order ${order.number} split into ${order.vendorOrders.map((v) => v.number).join(", ")}`);
  await page.goto(`${BASE}/account/downloads`);
  const dl = await page.locator('a:has-text("Download")').first().getAttribute("href");
  const file = await page.request.get(`${BASE}${dl}`); assert.equal(file.status(), 200);
  step("G: digital download granted and served after verified payment");
  const anon = await (await browser.newContext()).request.get(`${BASE}${dl}`, { maxRedirects: 0 });
  assert.equal(anon.status(), 307);
  step("G: download link refuses anonymous access");

  // ── Workflow D/E: vendor isolation, fulfilment, settlement ──
  await login(page, vEmail, "Password1234");
  const mine = order.vendorOrders.find((v) => v.vendorId === vendor.id);
  const other = order.vendorOrders.find((v) => v.vendorId !== vendor.id);
  assert.equal((await page.goto(`${BASE}/vendor/orders/${other.id}`)).status(), 404);
  step("D: vendor cannot open another vendor's sub-order (404)");
  await page.goto(`${BASE}/vendor/orders/${mine.id}`);
  await page.click('button:has-text("Accept and start preparing")'); await page.getByText("Order updated").waitFor();
  await page.click('button:has-text("Mark ready for dispatch")'); await page.getByText("Order updated").waitFor();
  await page.fill('input[name="carrier"]', "GIG Logistics"); await page.fill('input[name="trackingNumber"]', `GIG${run}`);
  await page.click('button:has-text("Mark as shipped")'); await page.getByText("Order updated").waitFor();
  await page.click('button:has-text("Confirm delivered")'); await page.getByText("Order updated").waitFor();
  step("D: vendor fulfilled only their own sub-order");
  const pend = await db.ledgerEntry.aggregate({ where: { account: { code: `vendor:${vendor.id}:pending` } }, _sum: { creditMinor: true } });
  assert.equal(pend._sum.creditMinor, mine.vendorNetMinor);
  step(`E: ledger credited vendor pending ₦${Number(mine.vendorNetMinor) / 100} (after 10% commission)`);

  // ── Workflow F: service booking ──
  await login(page, cEmail, "Password1234");
  const d = new Date(Date.now() + 2 * 864e5); while ([0].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  const date = d.toISOString().slice(0, 10);
  await page.goto(`${BASE}/services/logo-and-brand-identity-design-studio-nine?date=${date}`);
  await page.click('button:has-text("Book and pay")'); await page.waitForURL(/checkout\/sandbox/);
  await page.click('button[value="approve"]'); await page.waitForURL(/account\/orders\/XC-/);
  const booking = await db.booking.findFirstOrThrow({ where: { customer: { email: cEmail } } });
  assert.equal(booking.status, "REQUESTED");
  step(`F: buyer booked and paid for ${booking.number} at ${booking.startAt.toISOString()}`);
  await login(page, "studio-nine@demo.xavierconnect.local", "Demo-Vendor-2026!");
  await page.goto(`${BASE}/vendor/bookings`);
  await page.click('button:has-text("Confirm")'); await page.getByText("Booking updated").waitFor();
  assert.equal((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status, "CONFIRMED");
  step("F: provider confirmed the booking");

  await browser.close();
  await db.$disconnect();
  console.log("\nAll browser workflow checks passed.");
})().catch(async (e) => { console.error("✗", e); await db.$disconnect(); process.exit(1); });
