/**
 * Minimal OpenID Connect provider for automated tests of Google sign-in. It enforces what Google
 * enforces for this flow: client authentication, single-use codes bound to redirect_uri, PKCE (S256)
 * and an RS256-signed ID token carrying the request's nonce. Never used outside tests (the app only
 * accepts a discovery URL on localhost).
 */
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

export async function startMockOidc({ clientId, clientSecret, port = 0 }) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const kid = `test-${randomBytes(6).toString("hex")}`; // unique per run, like Google's rotating keys
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  const codes = new Map();
  let nextUser = { sub: "100000000000000000001", email: "someone@gmail.com", email_verified: true, name: "Test User" };
  let tamper = null; // "nonce" | "aud" | "signature"
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const base = `http://${req.headers.host}`;
    const json = (s, b) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(b)); };
    if (url.pathname === "/.well-known/openid-configuration") return json(200, { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks` });
    if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
    if (url.pathname === "/authorize") {
      const p = url.searchParams;
      if (p.get("client_id") !== clientId || p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256" || !p.get("code_challenge") || !p.get("nonce") || !p.get("state")) return json(400, { error: "invalid_request" });
      const code = randomBytes(16).toString("hex");
      codes.set(code, { challenge: p.get("code_challenge"), nonce: p.get("nonce"), redirect: p.get("redirect_uri"), user: nextUser });
      res.writeHead(302, { Location: `${p.get("redirect_uri")}?code=${code}&state=${encodeURIComponent(p.get("state"))}` });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let body = ""; for await (const c of req) body += c;
      const p = new URLSearchParams(body);
      const c = codes.get(p.get("code"));
      codes.delete(p.get("code")); // single use
      if (p.get("client_id") !== clientId || p.get("client_secret") !== clientSecret) return json(401, { error: "invalid_client" });
      if (!c || p.get("redirect_uri") !== c.redirect || p.get("grant_type") !== "authorization_code") return json(400, { error: "invalid_grant" });
      if (createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url") !== c.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE verification failed" });
      let token = await new SignJWT({ ...c.user, nonce: tamper === "nonce" ? "wrong" : c.nonce })
        .setProtectedHeader({ alg: "RS256", kid }).setIssuer(base).setAudience(tamper === "aud" ? "someone-else" : clientId)
        .setIssuedAt().setExpirationTime("5m").sign(privateKey);
      if (tamper === "signature") token = token.slice(0, -4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA");
      return json(200, { id_token: token, access_token: "x", token_type: "Bearer", expires_in: 300 });
    }
    json(404, { error: "not_found" });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, discovery: `${url}/.well-known/openid-configuration`, setUser: (u) => { nextUser = u; }, setTamper: (t) => { tamper = t; }, close: () => new Promise((r) => server.close(r)) };
}
