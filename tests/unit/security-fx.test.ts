import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson, hint } from "@/server/crypto";
import { base32Decode, base32Encode, totpCode, verifyTotp } from "@/server/auth/totp";
import { convertMinor, formatRate, parseRate } from "@/server/domain/fx";

process.env.ENCRYPTION_KEY ??= "0".repeat(64);

describe("encryption at rest", () => {
  it("round-trips and is non-deterministic", () => {
    const a = encryptJson({ secretKey: "sk_test_123" });
    expect(a).not.toContain("sk_test");
    expect(a).not.toBe(encryptJson({ secretKey: "sk_test_123" }));
    expect(decryptJson(a)).toEqual({ secretKey: "sk_test_123" });
  });
  it("rejects tampering", () => {
    const a = encryptJson({ x: 1 }).split(".");
    a[3] = a[3].slice(0, -2) + (a[3].endsWith("A") ? "BB" : "AA");
    expect(() => decryptJson(a.join("."))).toThrow();
  });
  it("masks", () => expect(hint("sk_live_abcdef")).toBe("••••cdef"));
});

describe("TOTP (RFC 6238 test vector)", () => {
  // RFC 6238 Appendix B, SHA-1 secret "12345678901234567890", T=59s -> 94287082 (8 digits); 6-digit = 287082
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC vector", () => {
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1111111109_000)).toBe("081804");
  });
  it("base32 round-trips", () => expect(base32Decode(secret).toString()).toBe("12345678901234567890"));
  it("accepts ±1 step, rejects others", () => {
    const now = 1_800_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, "abc", now)).toBe(false);
  });
});

describe("FX maths", () => {
  it("parses and formats rates exactly", () => {
    expect(formatRate(parseRate("0.004615384615"))).toBe("0.004615384615");
    expect(() => parseRate("1e-3")).toThrow();
    expect(() => parseRate("0")).toThrow();
  });
  it("converts NGN kobo to CNY fen rounding down", () => {
    // ₦100,000.00 at 0.0046 CNY/NGN = ¥460.00
    expect(convertMinor(10_000_000n, "0.0046")).toBe(46_000n);
    // ₦1.01 at 0.0046 = 0.004646 CNY -> 0 fen (rounded down, never over-promised)
    expect(convertMinor(101n, "0.0046")).toBe(0n);
    // huge amounts stay exact
    expect(convertMinor(9_007_199_254_740_993n, "1")).toBe(9_007_199_254_740_993n);
  });
});
