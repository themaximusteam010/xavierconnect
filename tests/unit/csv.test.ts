import { describe, expect, it } from "vitest";
import { csvCell, minorToDecimal, toCsv } from "@/lib/csv";

describe("csv export", () => {
  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+234")).toBe("'+234");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-1")).toBe("-1"); // plain negative number stays numeric
    expect(csvCell("-1+cmd")).toBe("'-1+cmd");
    expect(csvCell("Ada, Ltd")).toBe('"Ada, Ltd"');
  });
  it("writes money exactly from minor units", () => {
    expect(minorToDecimal(123456789012345678n)).toBe("1234567890123456.78");
    expect(minorToDecimal(-5n)).toBe("-0.05");
    expect(minorToDecimal(0n)).toBe("0.00");
  });
  it("builds rows with BOM and CRLF", () => {
    expect(toCsv(["a", "b"], [[1n, null]])).toBe("﻿a,b\r\n1,\r\n");
  });
});
