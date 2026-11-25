/**
 * Sign in with Google — OpenID Connect authorization-code flow with PKCE (S256), state and nonce.
 * Endpoints come from Google's discovery document; the ID token is verified on the server with
 * Google's published keys (jose), checking signature (RS256), issuer, audience, expiry and nonce.
 * The client secret never leaves the server.
 *
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (default APP_URL/auth/google/callback).
 * GOOGLE_OIDC_DISCOVERY_URL may point at a local mock issuer for automated tests; it is only honoured
 * for localhost URLs so production always talks to accounts.google.com.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { encryptJson, decryptJson } from "@/server/crypto";

export const OAUTH_COOKIE = "xc_oauth";
const GOOGLE_DISCOVERY = "https://accounts.google.com/.well-known/openid-configuration";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

function discoveryUrl() {
  const o = process.env.GOOGLE_OIDC_DISCOVERY_URL;
  if (o) { const h = new URL(o).hostname; if (h === "localhost" || h === "127.0.0.1") return { url: o, mock: true }; }
  return { url: GOOGLE_DISCOVERY, mock: false };
}

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
let cached: { at: number; url: string; doc: Discovery; jwks: ReturnType<typeof createRemoteJWKSet> } | null = null;
async function discovery() {
  const { url } = discoveryUrl();
  if (cached && cached.url === url && Date.now() - cached.at < 3600_000) return cached;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`OIDC discovery failed (${r.status})`);
  const doc = (await r.json()) as Discovery;
  cached = { at: Date.now(), url, doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)) };
  return cached;
}

export const redirectUri = () => process.env.GOOGLE_REDIRECT_URI ?? `${process.env.APP_URL ?? "http://localhost:3000"}/auth/google/callback`;
const b64url = (b: Buffer) => b.toString("base64url");

export interface OAuthState { state: string; nonce: string; verifier: string; next: string; linkUserId?: string; exp: number }

/** Build the Google authorisation URL and the encrypted, short-lived state cookie value. */
export async function beginGoogleLogin(opts: { next: string; linkUserId?: string }) {
  const { doc } = await discovery();
  const st: OAuthState = { state: b64url(randomBytes(32)), nonce: b64url(randomBytes(32)), verifier: b64url(randomBytes(48)), next: opts.next, linkUserId: opts.linkUserId, exp: Date.now() + 10 * 60_000 };
  const challenge = b64url(createHash("sha256").update(st.verifier).digest());
  const u = new URL(doc.authorization_endpoint);
  u.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(), response_type: "code", scope: "openid email profile",
    state: st.state, nonce: st.nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return { url: u.toString(), cookie: encryptJson(st) };
}

export class GoogleAuthError extends Error {}

export function readState(cookie: string | undefined, returnedState: string | null): OAuthState {
  if (!cookie || !returnedState) throw new GoogleAuthError("Your sign-in session expired. Please try again.");
  let st: OAuthState;
  try { st = decryptJson<OAuthState>(cookie); } catch { throw new GoogleAuthError("Your sign-in session is invalid. Please try again."); }
  if (st.exp < Date.now()) throw new GoogleAuthError("Your sign-in session expired. Please try again.");
  const a = Buffer.from(st.state), b = Buffer.from(returnedState);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new GoogleAuthError("Sign-in could not be verified (state mismatch). Please try again.");
  return st;
}

export interface GoogleClaims { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string }

/** Exchange the code (with the PKCE verifier) and verify the ID token. */
export async function finishGoogleLogin(code: string, st: OAuthState): Promise<GoogleClaims> {
  const { doc, jwks } = await discovery();
  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(), grant_type: "authorization_code", code_verifier: st.verifier }),
  });
  const tok = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !tok.id_token) throw new GoogleAuthError(`Google did not complete sign-in (${tok.error ?? res.status}).`);
  const issuers = discoveryUrl().mock ? [doc.issuer] : GOOGLE_ISSUERS;
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(tok.id_token, jwks, { issuer: issuers, audience: process.env.GOOGLE_CLIENT_ID!, algorithms: ["RS256"], clockTolerance: 60 }));
  } catch (e) {
    throw new GoogleAuthError(`Google's identity token could not be verified (${(e as Error).message}).`);
  }
  if (payload.nonce !== st.nonce) throw new GoogleAuthError("Sign-in could not be verified (nonce mismatch). Please try again.");
  if (!payload.sub) throw new GoogleAuthError("Google did not return an account identifier.");
  return { sub: String(payload.sub), email: typeof payload.email === "string" ? payload.email.toLowerCase() : undefined, email_verified: payload.email_verified === true, name: typeof payload.name === "string" ? payload.name : undefined, picture: typeof payload.picture === "string" ? payload.picture : undefined };
}
