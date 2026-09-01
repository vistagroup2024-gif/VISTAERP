"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { STOCK_REPORTS, PARAM_ARG, type Col } from "@/lib/stockReports";
import ReportFilters, { defaultFilters, type Filters } from "./ReportFilters";
import { cellText, isNumeric, downloadCsv } from "./reportFormat";

/**
 * The generic Inventory report: filter dialog on top, result grid below,
 * Print / Excel output. It takes the report KEY (never the config object) so
 * nothing that could become a function has to cross the server→client boundary.
 */
export default function StockReport({ report }: { report: string }) {
  const cfg = STOCK_REPORTS[report];
  const supabase = createClient();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!cfg) return;
    setBusy(true); setErr(null);
    const args: Record<string, any> = {};
    for (const p of cfg.params) {
      const key = PARAM_ARG[p];
      if (p === "mode") args[key] = cfg.mode ?? "fast";
      else if (p === "limit") args[key] = filters.limit;
      else if (p === "items") args[key] = filters.items;
      else if (p === "warehouse") args[key] = filters.warehouse;
      else if (p === "movedOnly") args[key] = filters.movedOnly;
      else args[key] = (filters as any)[p];
    }
    const { data, error } = await supabase.rpc(cfg.rpc, args);
    setBusy(false);
    if (error) { setErr(error.message); setRows([]); return; }
    setRows((data as any[]) ?? []);
  }, [cfg, supabase, filters]);

  // Reports with no date or item choice have nothing to configure — run at once.
  useEffect(() => {
    if (cfg && !cfg.params.some((p) => p === "from" || p === "to" || p === "asof" || p === "items")) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.key]);

  if (!cfg) return <p className="text-sm text-danger-fg">Unknown report &quot;{report}&quot;.</p>;

  return (
    <div>
      <div className="print:hidden">
        <ReportFilters needs={cfg.params as string[]} value={filters} onChange={setFilters} onRun={run} busy={busy} />
      </div>
      {err && <div className="mb-3 rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {rows === null
        ? <p className="text-sm text-slate-400">Choose the range and run the report.</p>
        : <Grid cfg={cfg} rows={rows} />}
    </div>
  );
}

function Grid({ cfg, rows }: { cfg: (typeof STOCK_REPORTS)[string]; rows: any[] }) {
  const totals: Record<string, number> = {};
  for (const c of cfg.cols) if (c.total) totals[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
  const hasTotals = cfg.cols.some((c) => c.total);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between print:hidden">
        <p className="text-sm text-slate-500">{rows.length} row{rows.length === 1 ? "" : "s"}</p>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={() => window.print()}>Print</button>
          <button className="btn-outline" onClick={() => downloadCsv(cfg.key, cfg.cols, rows)}>Excel (CSV)</button>
        </div>
      </div>
      <div className="card overflow-x-auto p-0 text-sm">
        <table className="w-full">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr>{cfg.cols.map((c) => (
              <th key={c.key} className={`px-3 py-2 ${isNumeric(c) ? "text-right" : "text-left"}`}>{c.label}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-t border-slate-100 ${r.low || r.short ? "bg-red-50/50" : ""}`}>
                {cfg.cols.map((c) => <Cell key={c.key} col={c} row={r} />)}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={cfg.cols.length} className="px-3 py-8 text-center text-slate-400">{cfg.empty}</td></tr>
            )}
          </tbody>
          {rows.length > 0 && hasTotals && (
            <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              {cfg.cols.map((c, i) => (
                <td key={c.key} className={`px-3 py-2 ${isNumeric(c) ? "text-right tabular-nums" : ""}`}>
                  {c.total ? cellText(c, totals[c.key]) : i === 0 ? "Total" : ""}
                </td>
              ))}
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Cell({ col, row }: { col: Col; row: any }) {
  const v = row[col.key];
  if (col.kind === "class") {
    const tone = v === "A" ? "bg-green-100 text-green-700" : v === "B" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
    return <td className="px-3 py-2 text-right"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>{v}</span></td>;
  }
  return <td className={`px-3 py-2 ${isNumeric(col) ? "text-right tabular-nums" : ""}`}>{cellText(col, v)}</td>;
}
