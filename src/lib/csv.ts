/**
 * CSV writer for finance/operations exports.
 * Cells that a spreadsheet would treat as a formula (=, +, -, @, tab, CR) are prefixed with a
 * single quote (OWASP CSV-injection guidance). Money is written from bigint minor units as an
 * exact decimal string — never through floating point.
 */
export type Cell = string | number | bigint | boolean | Date | null | undefined;

export function minorToDecimal(minor: bigint, decimals = 2): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${whole}${decimals ? "." + frac : ""}`;
}

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : typeof v === "bigint" ? v.toString() : String(v);
  // Plain numbers are safe; anything else that starts with a formula trigger is neutralised.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
