/**
 * AES-256-GCM encryption for secrets at rest (provider credentials, beneficiary details).
 * ENCRYPTION_KEY: 64 hex chars (32 bytes). Rotating it requires re-encrypting stored values.
 * Format: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const k = process.env.ENCRYPTION_KEY;
  if (!k || !/^[0-9a-f]{64}$/i.test(k)) throw new Error("ENCRYPTION_KEY must be 64 hex characters");
  return Buffer.from(k, "hex");
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptJson<T = unknown>(blob: string): T {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8")) as T;
}

/** Last four visible characters, for display only. */
export const hint = (s: string) => (s.length <= 4 ? "••••" : `••••${s.slice(-4)}`);
