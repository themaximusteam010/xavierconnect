import { describe, expect, it } from "vitest";
import { lagosToUtc, lagosWeekday } from "@/server/services/bookings";

describe("Lagos time conversion", () => {
  it("converts local wall-clock to UTC (UTC+1)", () => {
    expect(lagosToUtc("2026-12-01", 9 * 60).toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(lagosToUtc("2026-12-01", 0).toISOString()).toBe("2026-11-30T23:00:00.000Z");
  });
  it("finds the weekday of a local date", () => {
    expect(lagosWeekday("2026-11-25")).toBe(3); // Wednesday
  });
});
