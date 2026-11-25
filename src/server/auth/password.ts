import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended argon2id parameters (m=19 MiB, t=2, p=1).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => hash(pw, OPTS);
export async function verifyPassword(hashStr: string, pw: string) {
  try {
    return await verify(hashStr, pw);
  } catch {
    return false;
  }
}
