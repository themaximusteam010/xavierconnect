import { describe, expect, it } from "vitest";
import { allocate, applyBps, formatMoney, parseNairaToMinor } from "@/lib/money";

describe("money", () => {
  it("formats kobo as naira without float error", () => {
    expect(formatMoney(10_000_000n)).toBe("₦100,000");
    expect(formatMoney(1_999n)).toBe("₦19.99");
    expect(formatMoney(-50_00n)).toBe("-₦50");
    expect(formatMoney(9_007_199_254_740_993n)).toContain("90,071,992,547,409"); // > 2^53 kobo stays exact
  });
  it("parses user input", () => {
    expect(parseNairaToMinor("12,500.5")).toBe(1_250_050n);
    expect(parseNairaToMinor("₦100")).toBe(10_000n);
    expect(parseNairaToMinor("1.234")).toBeNull();
    expect(parseNairaToMinor("-5")).toBeNull();
  });
  it("applies basis points with half-up rounding", () => {
    expect(applyBps(10_000_000n, 1000)).toBe(1_000_000n); // 10% of ₦100,000
    expect(applyBps(5n, 1000)).toBe(1n); // 0.5 rounds up
    expect(applyBps(4n, 1000)).toBe(0n);
  });
  it("allocates exactly", () => {
    const parts = allocate(100n, [1n, 1n, 1n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(parts).toEqual([34n, 33n, 33n]);
    expect(allocate(0n, [5n, 5n])).toEqual([0n, 0n]);
  });
});
