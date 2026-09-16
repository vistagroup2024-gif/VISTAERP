"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import type { ReportCfg } from "@/lib/reports/types";
import { NEED_ARG } from "@/lib/reports/types";
import { downloadCsv } from "@/lib/reports/export";
import ReportFilterBar, { defaultReportFilters, type Filters } from "./ReportFilters";
import DataTable, { type DataGroup } from "./DataTable";
import PrintButton from "@/components/PrintButton";
import type { MultiOption } from "@/components/ui/MultiSearchSelect";
import type { Need } from "@/lib/reports/types";

/**
 * The thin registry-driven wrapper every report page renders — successor to
 * StockReport, generalised to any ReportCfg registry rather than only
 * STOCK_REPORTS. Takes the report KEY (never the config object, see
 * lib/reports/types.ts) plus the filter `options` bag a report's own module
 * knows the shape of (statuses, vehicles, drivers…).
 *
 * journal_lines.cost_center/tag_area are plain TEXT, not the id
 * ReportFilterBar's pickers work in — a report whose RPC filters by NAME
 * declares the "costCenterName"/"tagAreaName" need instead of
 * "costCenter"/"tagArea", and this is the one place that resolves the
 * user's ticked ids back to names before the RPC is called, fetching the
 * id→name map itself only when a report actually needs it.
 */
export default function ReportRunner({ registry, report, options, onData }: {
  registry: Record<string, ReportCfg>;
  report: string;
  options?: Partial<Record<Need, MultiOption[]>>;
  /** Lets the page wrapping this engine build its own KPI row off the exact
   *  rows/groups just fetched — never a second fetch of its own that could
   *  show a different filtered state than the table underneath it. */
  onData?: (rows: any[] | null, groups: DataGroup[] | undefined) => void;
}) {
  const cfg = registry[report];
  const supabase = useMemo(() => createClient(), []);
  const [filters, setFilters] = useState<Filters>(defaultReportFilters);
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ccNames, setCcNames] = useState<Map<string, string>>(new Map());
  const [taNames, setTaNames] = useState<Map<string, string>>(new Map());

  const needsCcNames = !!cfg?.params.includes("costCenterName");
  const needsTaNames = !!cfg?.params.includes("tagAreaName");

  useEffect(() => {
    if (needsCcNames) {
      fetchAllRows<{ id: string; name: string }>((from, to) => supabase.from("acct_cost_centers")
        .select("id, name").order("id").range(from, to))
        .then(({ data }) => setCcNames(new Map(data.map((r) => [r.id, r.name]))));
    }
    if (needsTaNames) {
      fetchAllRows<{ id: string; name: string }>((from, to) => supabase.from("acct_tag_areas")
        .select("id, name").order("id").range(from, to))
        .then(({ data }) => setTaNames(new Map(data.map((r) => [r.id, r.name]))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCcNames, needsTaNames]);

  const run = useCallback(async () => {
    if (!cfg) return;
    setBusy(true); setErr(null);
    const args: Record<string, any> = { ...cfg.fixedArgs };
    for (const p of cfg.params) {
      const key = cfg.argMap?.[p] ?? NEED_ARG[p];
      if (p === "mode") { args[key] = cfg.mode; continue; }
      if (p === "costCenterName") { args[key] = filters.costCenter?.map((id) => ccNames.get(id)).filter(Boolean) ?? null; continue; }
      if (p === "tagAreaName") { args[key] = filters.tagArea?.map((id) => taNames.get(id)).filter(Boolean) ?? null; continue; }
      // "…Group" needs share the same picker/storage as their singular form
      // (ticking a group in the tree already ticks every leaf under it).
      const src = p === "accountGroup" ? "account" : p === "productGroup" ? "product" : p === "itemGroup" ? "items" : p;
      args[key] = (filters as any)[src];
    }
    const { data, error } = await supabase.rpc(cfg.rpc, args);
    setBusy(false);
    if (error) { setErr(error.message); setRows([]); return; }
    setRows((data as any[]) ?? []);
  }, [cfg, supabase, filters, ccNames, taNames]);

  // A report with no date/period/tree choice has nothing to configure — run
  // once on mount, exactly like StockReport already does.
  useEffect(() => {
    if (cfg && !cfg.params.some((p) => ["from", "to", "asof", "month", "year", "items", "product", "account", "party"].includes(p))) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.key]);

  // "grouped" reports' RPC returns the DataGroup[] shape directly (one block
  // per account/entity, its own rows and subtotal) — see lib/reports/types.ts.
  const isGrouped = cfg?.shape === "grouped";
  const groups: DataGroup[] | undefined = isGrouped ? ((rows as DataGroup[]) ?? []) : undefined;
  const flatRows = !isGrouped ? rows ?? [] : [];
  const exportRows = isGrouped ? (groups ?? []).flatMap((g) => g.rows) : flatRows;

  useEffect(() => {
    onData?.(rows, groups);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  if (!cfg) return <p className="text-sm text-danger-fg">Unknown report &quot;{report}&quot;.</p>;

  return (
    <div>
      <div className="print:hidden">
        <ReportFilterBar needs={cfg.params} value={filters} onChange={setFilters} onRun={run} busy={busy} options={options} />
      </div>
      {err && <div className="mb-3 rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {rows === null ? (
        <p className="text-sm text-slate-400">Choose the filters and run the report.</p>
      ) : (
        <>
          <div className="mb-2 flex justify-end gap-2 print:hidden">
            <PrintButton />
            <button className="btn-outline" onClick={() => downloadCsv(cfg.key, cfg.cols, exportRows)}>Excel (CSV)</button>
          </div>
          <DataTable cols={cfg.cols} rows={isGrouped ? undefined : flatRows} groups={groups} empty={cfg.empty} />
        </>
      )}
    </div>
  );
}
