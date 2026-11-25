/**
 * Google sign-in: protocol (state, nonce, PKCE, signature, audience) against a local mock OpenID
 * provider, and the account-linking policy against a real database. Acceptance tests 16, 18, 19.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { syncRbac } from "../../prisma/rbac-sync";
import { beginGoogleLogin, finishGoogleLogin, readState, GoogleAuthError } from "@/server/auth/google";
import { resolveGoogleLogin, unlinkGoogle, LinkRefused } from "@/server/services/google-accounts";
// @ts-expect-error — plain ESM test helper
import { startMockOidc } from "../mock-oidc.mjs";

process.env.ENCRYPTION_KEY ??= "1".repeat(64);
let mock: { url: string; discovery: string; setUser: (u: object) => void; setTamper: (t: string | null) => void; close: () => Promise<void> };

beforeAll(async () => {
  await syncRbac(db);
  mock = await startMockOidc({ clientId: "test-client.apps.googleusercontent.com", clientSecret: "test-secret" });
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret", GOOGLE_OIDC_DISCOVERY_URL: mock.discovery, GOOGLE_REDIRECT_URI: "http://localhost:3000/auth/google/callback" });
});
afterAll(async () => { await mock.close(); for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OIDC_DISCOVERY_URL", "GOOGLE_REDIRECT_URI"]) delete process.env[k]; });

/** Drives the browser part: follow the authorize redirect and pull out code + state. */
async function authorize(next = "/account") {
  const { url, cookie } = await beginGoogleLogin({ next });
  const r = await fetch(url, { redirect: "manual" });
  const loc = new URL(r.headers.get("location")!);
  return { cookie, code: loc.searchParams.get("code")!, state: loc.searchParams.get("state")!, authUrl: new URL(url) };
}

describe("Test 16: OpenID Connect flow", () => {
  it("sends PKCE (S256), state, nonce and the openid email profile scope", async () => {
    const { authUrl } = await authorize();
    const p = authUrl.searchParams;
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("scope")).toBe("openid email profile");
    expect(p.get("state")!.length).toBeGreaterThan(30);
    expect(p.get("nonce")!.length).toBeGreaterThan(30);
    expect(authUrl.toString()).not.toContain("test-secret");
  });
  it("exchanges the code and verifies the signed ID token", async () => {
    mock.setUser({ sub: "g-1", email: "Ada.New@Gmail.com", email_verified: true, name: "Ada New" });
    const a = await authorize();
    const claims = await finishGoogleLogin(a.code, readState(a.cookie, a.state));
    expect(claims).toMatchObject({ sub: "g-1", email: "ada.new@gmail.com", email_verified: true });
  });
  it("rejects a state mismatch, an expired/forged state cookie, and code reuse", async () => {
    const a = await authorize();
    expect(() => readState(a.cookie, "attacker-state")).toThrow(GoogleAuthError);
    expect(() => readState("v1.forged.cookie.value", a.state)).toThrow(GoogleAuthError);
    expect(() => readState(undefined, a.state)).toThrow(GoogleAuthError);
    const st = readState(a.cookie, a.state);
    await finishGoogleLogin(a.code, st);
    await expect(finishGoogleLogin(a.code, st)).rejects.toThrow(GoogleAuthError);
  });
  it("rejects a wrong PKCE verifier", async () => {
    const a = await authorize();
    await expect(finishGoogleLogin(a.code, { ...readState(a.cookie, a.state), verifier: "x".repeat(64) })).rejects.toThrow(/did not complete/);
  });
  it.each(["nonce", "aud", "signature"])("rejects an ID token with a bad %s", async (t) => {
    mock.setTamper(t);
    const a = await authorize();
    await expect(finishGoogleLogin(a.code, readState(a.cookie, a.state))).rejects.toThrow(GoogleAuthError);
    mock.setTamper(null);
  });
  it("ignores a non-localhost discovery override (production always uses Google)", async () => {
    process.env.GOOGLE_OIDC_DISCOVERY_URL = "https://evil.example/.well-known/openid-configuration";
    const { url } = await beginGoogleLogin({ next: "/" });
    expect(new URL(url).host).toBe("accounts.google.com");
    process.env.GOOGLE_OIDC_DISCOVERY_URL = mock.discovery;
  });
});

describe("Tests 18–19: account linking without duplicates or privilege", () => {
  const role = (k: string) => db.role.findUniqueOrThrow({ where: { key: k } });
  it("a new Google user gets one ordinary customer account; signing in again reuses it", async () => {
    const a = await resolveGoogleLogin({ sub: "g-new", email: "fresh@gmail.com", email_verified: true, name: "Fresh" });
    const b = await resolveGoogleLogin({ sub: "g-new", email: "fresh@gmail.com", email_verified: true, name: "Fresh" });
    expect(a.created).toBe(true); expect(b.userId).toBe(a.userId); expect(b.created).toBe(false);
    expect(await db.user.count({ where: { email: "fresh@gmail.com" } })).toBe(1);
    const u = await db.user.findUniqueOrThrow({ where: { id: a.userId }, include: { roles: { include: { role: true } } } });
    expect(u.roles.map((r) => r.role.key)).toEqual(["CUSTOMER"]);
    expect(u.passwordHash).toBeNull();
    expect(u.emailVerifiedAt).not.toBeNull();
  });
  it("a verified Gmail account with a password is linked, not duplicated", async () => {
    const u = await db.user.create({ data: { email: "ada@gmail.com", name: "Ada", passwordHash: "h", emailVerifiedAt: new Date(), roles: { create: { roleId: (await role("CUSTOMER")).id } } } });
    const r = await resolveGoogleLogin({ sub: "g-ada", email: "ada@gmail.com", email_verified: true });
    expect(r).toMatchObject({ userId: u.id, created: false, linked: true });
    expect(await db.user.count({ where: { email: "ada@gmail.com" } })).toBe(1);
  });
  it("does not auto-link an unverified account (pre-registration takeover) or a non-Gmail domain", async () => {
    await db.user.create({ data: { email: "victim@gmail.com", name: "Victim?", passwordHash: "attacker-set" } });
    await expect(resolveGoogleLogin({ sub: "g-victim", email: "victim@gmail.com", email_verified: true })).rejects.toThrow(LinkRefused);
    await db.user.create({ data: { email: "boss@company.ng", name: "Boss", passwordHash: "h", emailVerifiedAt: new Date() } });
    await expect(resolveGoogleLogin({ sub: "g-boss", email: "boss@company.ng", email_verified: true })).rejects.toThrow(LinkRefused);
    expect(await db.externalIdentityAccount.count({ where: { subject: { in: ["g-victim", "g-boss"] } } })).toBe(0);
    expect(await db.oAuthAccountLink.count({ where: { action: "REFUSED" } })).toBeGreaterThanOrEqual(2);
  });
  it("never auto-links a staff account", async () => {
    await db.user.create({ data: { email: "staff@gmail.com", name: "Staff", passwordHash: "h", emailVerifiedAt: new Date(), roles: { create: { roleId: (await role("SUPER_ADMIN")).id } } } });
    await expect(resolveGoogleLogin({ sub: "g-staff", email: "staff@gmail.com", email_verified: true })).rejects.toThrow(LinkRefused);
  });
  it("refuses unverified Google emails", async () => {
    await expect(resolveGoogleLogin({ sub: "g-unv", email: "x@gmail.com", email_verified: false })).rejects.toThrow(LinkRefused);
  });
  it("explicit linking from settings, and one Google identity can't be attached to two users", async () => {
    const u = await db.user.create({ data: { email: "linker@company.ng", name: "Linker", passwordHash: "h", emailVerifiedAt: new Date() } });
    await resolveGoogleLogin({ sub: "g-linker", email: "linker.personal@gmail.com", email_verified: true }, { linkUserId: u.id });
    expect((await resolveGoogleLogin({ sub: "g-linker", email: "linker.personal@gmail.com", email_verified: true })).userId).toBe(u.id);
    const other = await db.user.create({ data: { email: "other@company.ng", name: "Other", passwordHash: "h", emailVerifiedAt: new Date() } });
    await expect(resolveGoogleLogin({ sub: "g-linker", email: "x@gmail.com", email_verified: true }, { linkUserId: other.id })).rejects.toThrow(LinkRefused);
  });
  it("Test 19: a vendor application is not approved by signing in with Google", async () => {
    const r = await resolveGoogleLogin({ sub: "g-seller", email: "seller.google@gmail.com", email_verified: true });
    const v = await db.vendor.create({ data: { ownerId: r.userId, type: "INDIVIDUAL", businessName: "G Seller", email: "seller.google@gmail.com", phone: "08030000000" } });
    await resolveGoogleLogin({ sub: "g-seller", email: "seller.google@gmail.com", email_verified: true });
    expect((await db.vendor.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("DRAFT");
    expect(await db.userRole.count({ where: { userId: r.userId, vendorId: { not: null } } })).toBe(0);
  });
  it("a Google-only account can't disconnect Google until it has a password", async () => {
    const r = await resolveGoogleLogin({ sub: "g-only", email: "only@gmail.com", email_verified: true });
    await expect(unlinkGoogle(r.userId)).rejects.toThrow(LinkRefused);
  });
});
