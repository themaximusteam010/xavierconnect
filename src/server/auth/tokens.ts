import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function secret() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET must be set (32+ chars)");
  return s;
}

/** HMAC-signed, expiring value. Used for download links and the sandbox payment page. */
export function sign(payload: string, expiresAtMs: number) {
  const body = `${payload}.${expiresAtMs}`;
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${Buffer.from(body).toString("base64url")}.${mac}`;
}

export function verifySigned(token: string): string | null {
  const [b, mac] = token.split(".");
  if (!b || !mac) return null;
  const body = Buffer.from(b, "base64url").toString();
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const e = Buffer.from(expected);
  if (a.length !== e.length || !timingSafeEqual(a, e)) return null;
  const idx = body.lastIndexOf(".");
  const exp = Number(body.slice(idx + 1));
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return body.slice(0, idx);
}
