import type { Col } from "./types";

export const money = (n: any) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
export const qtyf = (n: any) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number(n) || 0);

/** Value as it should read on screen and in the CSV. */
export function cellText(col: Col, v: any): string {
  if (v === null || v === undefined || v === "")
    return col.kind && col.kind !== "text" && col.kind !== "class" && col.kind !== "date" ? "0" : "—";
  switch (col.kind) {
    case "money": return money(v);
    case "qty": return qtyf(v);
    case "pct": return `${Number(v).toFixed(2)}%`;
    case "int": return String(v);
    case "date": return String(v);
    default: return String(v);
  }
}

export const isNumeric = (col: Col) =>
  col.kind === "money" || col.kind === "qty" || col.kind === "pct" || col.kind === "int";

/** Every report's Excel/CSV button goes through this — one CSV/Blob
 *  implementation instead of the four that had grown up independently
 *  (Inventory, Ledger, Transport Ledger, Visa Ledger). */
export function downloadCsv(filename: string, cols: Col[], rows: any[]) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const body = [
    cols.map((c) => esc(c.label)).join(","),
    ...rows.map((r) => cols.map((c) => esc(cellText(c, r[c.key]).replace(/,/g, ""))).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${filename}.csv`; a.click();
  URL.revokeObjectURL(url);
}
