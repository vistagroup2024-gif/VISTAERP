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
import { asOfFromYearMonths, monthRanges, type YearMonths } from "@/lib/reports/period";

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
export default function ReportRunner({ registry, report, options, onData, initialFilters, periodValue }: {
  registry: Record<string, ReportCfg>;
  report: string;
  options?: Partial<Record<Need, MultiOption[]>>;
  /** Lets the page wrapping this engine build its own KPI row off the exact
   *  rows/groups just fetched — never a second fetch of its own that could
   *  show a different filtered state than the table underneath it. */
  onData?: (rows: any[] | null, groups: DataGroup[] | undefined) => void;
  /** Pre-fills specific filters on first load — how a drilldown link (Stock
   *  Valuation's item -> Stock Movement pre-filtered to it) arrives already
   *  scoped, instead of opening the report empty and making the owner pick
   *  the same item again by hand. Only read once, on mount. */
  initialFilters?: Partial<Filters>;
  /** The header's PeriodDropdown value, for a report whose `cfg.period` is
   *  set — read instead of filters.asof/from/to for that report's period
   *  arg(s), and excluded from the filter bar so the date box doesn't also
   *  show there. The page rendering the header owns this state; ReportRunner
   *  never renders the dropdown itself (it sits in the title row, above
   *  where this component starts). */
  periodValue?: YearMonths;
}) {
  const cfg = registry[report];
  const supabase = useMemo(() => createClient(), []);
  const [filters, setFilters] = useState<Filters>(() => ({ ...defaultReportFilters(), ...initialFilters }));
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
    // A report's period, when it has one, comes from the header's
    // PeriodDropdown rather than filters.asof/from/to — resolved here so
    // the RPC call is unchanged, only where its date(s) come from.
    const range = cfg.period === "range" && periodValue ? monthRanges(periodValue) : null;
    for (const p of cfg.params) {
      const key = cfg.argMap?.[p] ?? NEED_ARG[p];
      if (p === "mode") { args[key] = cfg.mode; continue; }
      if (cfg.period === "asof" && p === "asof" && periodValue) { args[key] = asOfFromYearMonths(periodValue); continue; }
      if (range && p === "from") { args[key] = range[0]?.from ?? filters.from; continue; }
      if (range && p === "to") { args[key] = range[range.length - 1]?.to ?? filters.to; continue; }
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
  }, [cfg, supabase, filters, ccNames, taNames, periodValue]);

  // Auto-run on mount whenever every one of the report's params already has a
  // real, sensible default — from/to/asof/month/year all do (today, current
  // year — see defaultReportFilters()), and so does an optional multi-select
  // filter like account/costCenter/tagArea (empty = "all", already a valid
  // report). The owner should see the current period's picture the moment
  // the screen opens, not after pressing "Run report" on values that were
  // already filled in. Only "items", "product" and "party" stay excluded:
  // each names ONE specific thing the report is about, with no default that
  // means anything (an empty items/product/party filter is not "the whole
  // company's stock/ledger", it is "nothing chosen yet").
  useEffect(() => {
    // A drilldown link can arrive with one of these already picked
    // (initialFilters) — that's a real selection, not "nothing chosen
    // yet", so it does not hold back auto-run the way an empty one does.
    const stillUnpicked = (p: string) => ["items", "product", "party"].includes(p) && !((filters as any)[p]?.length);
    if (cfg && !cfg.params.some(stillUnpicked)) run();
    // Re-runs on every PeriodDropdown change too, for a report whose period
    // it drives — the same "no Run button, it just applies" rule every
    // other period control in the ERP follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.key, periodValue?.year, periodValue?.months.join(",")]);

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

  // The period param(s) this report's `cfg.period` already draws from the
  // header's PeriodDropdown are dropped from the filter bar — showing them
  // there too would be the same date asked twice, in two different controls.
  const barNeeds = cfg.params.filter((p) =>
    !(cfg.period === "asof" && p === "asof") && !(cfg.period === "range" && (p === "from" || p === "to")));

  return (
    <div>
      <div className="print:hidden">
        <ReportFilterBar needs={barNeeds} value={filters} onChange={setFilters} onRun={run} busy={busy} options={options} />
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
