import type { CustomerRow } from "./types.js";

/** Pure helpers of the console: periods, paging, filtering and the CSV statement. */

export type CustomerFilter = "all" | "credit_low" | "past_due" | "paused";

export const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export function periodOf(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The `count` months ending at `period`, oldest first. */
export function lastPeriods(period: string, count: number): string[] {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return Array.from({ length: count }, (_, index) => {
    const at = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return periodOf(at);
  });
}

/** Whether a customer belongs under a filter. A paused customer is never "credit low". */
export function matchesFilter(row: CustomerRow, filter: CustomerFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "paused":
      return row.state === "paused";
    case "past_due":
      return row.state === "past_due";
    case "credit_low":
      return row.lowCredit && row.state !== "paused";
  }
}

/** Newest customers first; the id breaks ties so a page boundary never repeats or skips a row. */
export function compareCustomers(a: CustomerRow, b: CustomerRow): number {
  const byDate = b.since.getTime() - a.since.getTime();
  if (byDate !== 0) return byDate;
  return a.tenantId < b.tenantId ? 1 : a.tenantId > b.tenantId ? -1 : 0;
}

export function encodeCursor(row: Pick<CustomerRow, "since" | "tenantId">): string {
  return Buffer.from(JSON.stringify([row.since.getTime(), row.tenantId])).toString("base64url");
}

export function decodeCursor(cursor: string): { at: number; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "number" &&
      Number.isFinite(parsed[0]) &&
      typeof parsed[1] === "string"
    ) {
      return { at: parsed[0], id: parsed[1] };
    }
  } catch {
    // Falls through to the refusal below.
  }
  return null;
}

/** Whether `row` comes after the cursor in `compareCustomers` order. */
export function isAfterCursor(row: CustomerRow, cursor: { at: number; id: string }): boolean {
  return (
    compareCustomers(row, { since: new Date(cursor.at), tenantId: cursor.id } as CustomerRow) > 0
  );
}

/** Minor units as a decimal, for the two-decimal currencies the catalog has (BRL, USD). */
export function formatMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** A cell that a spreadsheet cannot run as a formula, quoted when it needs to be. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export interface StatementLine {
  at: string;
  tenantName: string;
  kind: string;
  baseMinor: number;
  rookShareMinor: number;
  commissionMinor: number;
  markupMinor: number;
  paidMinor: number;
}

export function statementCsv(lines: StatementLine[]): string {
  const rows = [
    ["date", "customer", "kind", "base", "rook_share", "commission", "markup", "paid"],
    ...lines.map((line) => [
      line.at.slice(0, 10),
      line.tenantName,
      line.kind,
      formatMinor(line.baseMinor),
      formatMinor(line.rookShareMinor),
      formatMinor(line.commissionMinor),
      formatMinor(line.markupMinor),
      formatMinor(line.paidMinor),
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
