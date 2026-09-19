"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, monthShort } from "@/lib/format";
import { todaySA, yearSA, monthStartSA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import ReportKpi from "@/components/reports/ReportKpi";
import SectionHeader from "@/components/reports/SectionHeader";
import TrendChart from "@/components/reports/charts/TrendChart";
import DonutChart from "@/components/reports/charts/DonutChart";
import DataTable, { type DataGroup } from "@/components/reports/DataTable";
import { defaultYearMonths, monthRanges, type YearMonths } from "@/lib/reports/period";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const pct = (n: number) => `${n.toFixed(1)}%`;

function pad(n: number) { return String(n).padStart(2, "0"); }
function lastMonthRange(): [string, string] {
  const t = todaySA(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return [`${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${pad(last)}`];
}
function shiftYear(d: string, delta: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  return `${y + delta}-${pad(m)}-${pad(dd)}`;
}

function summarize(rs: any[]) {
  const income = rs.filter((r) => r.nature === "income").map((r) => ({ ...r, amt: Number(r.period_credit) - Number(r.period_debit) })).filter((r) => r.amt);
  const costs = rs.filter((r) => r.nature === "expense" && r.subtype === "COGS").map((r) => ({ ...r, amt: Number(r.period_debit) - Number(r.period_credit) })).filter((r) => r.amt);
  const expense = rs.filter((r) => r.nature === "expense" && r.subtype !== "COGS").map((r) => ({ ...r, amt: Number(r.period_debit) - Number(r.period_credit) })).filter((r) => r.amt);
  const totInc = income.reduce((s, r) => s + r.amt, 0);
  const totCost = costs.reduce((s, r) => s + r.amt, 0);
  const totExp = expense.reduce((s, r) => s + r.amt, 0);
  const gross = totInc - totCost;
  const net = gross - totExp;
  return { income, costs, expense, totInc, totCost, totExp, gross, net };
}

// Last Month / Current Month / Year to Date — three fixed calendar windows,
// each Net Profit less Drawings less Actual Net, so the owner sees where
// things stand right now without touching the period filter above. Same
// dark-green-header-over-light-body shape as every other report card now.
function PeriodBox({ title, net, drawings }: { title: string; net: number; drawings: number }) {
  const actNet = net - drawings;
  return (
    <div className="card overflow-hidden p-0">
      <div className="bg-brand-700 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">{title}</div>
      <div className="grid grid-cols-3 gap-2 p-3 text-center">
        <div><p className="text-xs text-slate-400">Net</p><p className={`font-bold tabular-nums ${net >= 0 ? "text-slate-800" : "text-red-700"}`}>{money(net)}</p></div>
        <div><p className="text-xs text-slate-400">Drawing</p><p className="font-bold tabular-nums text-slate-800">{money(drawings)}</p></div>
        <div><p className="text-xs text-slate-400">Act. Net</p><p className={`font-bold tabular-nums ${actNet >= 0 ? "text-green-700" : "text-red-700"}`}>{money(actNet)}</p></div>
      </div>
    </div>
  );
}

// Revenue / Gross / Expenses / Net as one bar each, scaled against Revenue —
// the headline shape, not the account-by-account listing this page used to
// carry. The full account breakdown is one click away on the report that
// already owns it (Expenses -> Targets & Budget's Expense Budget tab), so
// it isn't duplicated here.
function ElementBar({ label, value, basis, tone, href }: { label: string; value: number; basis: number; tone: string; href?: string }) {
  const width = basis !== 0 ? Math.max(2, Math.min(100, (Math.abs(value) / Math.abs(basis)) * 100)) : 0;
  const row = (
    <div className="flex items-center gap-3 px-1 py-1.5">
      <span className="w-32 shrink-0 text-xs text-slate-500">{label}</span>
      <div className="h-3 flex-1 rounded-full bg-slate-100">
        <div className={`h-3 rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
      <span className="w-28 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700">{money(value)}</span>
    </div>
  );
  return href ? <Link href={href} className="block hover:bg-slate-50">{row}</Link> : row;
}

const EMPTY_ARR: any[] = [];

// report_pl_matrix() (443) — one row per (cost centre, tag area, month),
// carrying both dimensions' ids/names/groups at once, the P&L twin of
// report_expense_matrix() (441/442). CC Group, Cost Center, Tag Area Group
// and Tag Area are four freely-combinable, freely-orderable levels of the
// SAME rows now — a journal line always carries both a cost_center and a
// tag_area, so "this cost centre's own tag areas" is a real question, not
// a mismatched comparison between two separate RPCs the way it was before
// 443 (report_cost_centre_costing() vs report_tag_area_costing()).
type MatrixRow = {
  cost_center_id: string | null; cost_center: string; cost_center_group: string;
  tag_area_id: string | null; tag_area: string; tag_area_group: string;
  month: string; sales: number; cogs: number; expense: number; drawing: number;
};
type PLDim = "ccGroup" | "costCenter" | "tagAreaGroup" | "tagArea";
type PLLevel = { key: PLDim; label: string; field: (r: MatrixRow) => string };
// Fixed order for the button row only — nesting order is whichever order
// they're actually CLICKED in (see plDimOrder below), not this array's order.
const PL_LEVELS: PLLevel[] = [
  { key: "ccGroup", label: "CC Group", field: (r) => r.cost_center_group },
  { key: "costCenter", label: "Cost Center", field: (r) => r.cost_center },
  { key: "tagAreaGroup", label: "Tag Area Group", field: (r) => r.tag_area_group },
  { key: "tagArea", label: "Tag Area", field: (r) => r.tag_area },
];
const PL_LEVEL_BY_KEY = new Map(PL_LEVELS.map((l) => [l.key, l]));

function groupByField(rows: MatrixRow[], field: (r: MatrixRow) => string): Map<string, MatrixRow[]> {
  const m = new Map<string, MatrixRow[]>();
  for (const r of rows) { const k = field(r); const arr = m.get(k) ?? []; arr.push(r); m.set(k, arr); }
  return m;
}
function monthRowsFromMatrix(rs: MatrixRow[]) {
  const byMonth = new Map<string, { sales: number; cogs: number; expense: number; drawing: number }>();
  for (const r of rs) {
    const e = byMonth.get(r.month) ?? { sales: 0, cogs: 0, expense: 0, drawing: 0 };
    e.sales += r.sales; e.cogs += r.cogs; e.expense += r.expense; e.drawing += r.drawing;
    byMonth.set(r.month, e);
  }
  return Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, m]) => ({ label: monthShort(month), ...plValues(m.sales, m.cogs, m.expense, m.drawing) }));
}
// One recursive builder over however many levels are active, in click
// order — the exact shape buildExpenseLevels() (ExpenseReportView.tsx)
// already proved: Cost Center then Tag Area nests Tag Area under each
// Cost Center; the same two clicked the other way round nests the other
// way. A leaf level expands into its own months only when Month wise is on.
function buildPLLevels(rows: MatrixRow[], levels: PLLevel[], withMonth: boolean, depth = 0): DataGroup[] {
  if (depth >= levels.length) return [];
  const byKey = groupByField(rows, levels[depth].field);
  const isLast = depth === levels.length - 1;
  return Array.from(byKey.entries()).map(([key, rs]) => {
    const sales = rs.reduce((s, r) => s + r.sales, 0), cogs = rs.reduce((s, r) => s + r.cogs, 0), expense = rs.reduce((s, r) => s + r.expense, 0);
    const drawing = rs.reduce((s, r) => s + r.drawing, 0);
    const values = plValues(sales, cogs, expense, drawing);
    return {
      key: `${depth}:${key}`, label: key, values, rows: isLast && withMonth ? monthRowsFromMatrix(rs) : [],
      ...(isLast ? {} : { subgroups: buildPLLevels(rs, levels, withMonth, depth + 1) }),
    };
  }).sort((a, b) => Number(b.values!.revenue) - Number(a.values!.revenue));
}

// Drawing is a REAL per-(cost centre, tag area, month) figure now —
// report_pl_matrix() (443, extended) reads it off exactly the same
// cost_center/tag_area a Drawing posting's own line already carries (a
// Payment against a Drawing account typed with Cost Centre "MAIN" is
// ordinary data entry, not a special case), the same way sales/cogs/expense
// are already grouped. So every row — flat month, CC Group, Cost Center,
// Tag Area, at any depth — gets a real, attributed Drawing/Actual Net/Act %,
// not a fabricated zero: `drawing` is always a real sum of real lines,
// simply 0 where nobody has typed a drawing against that grouping.
// Deliberately NOT folded into Expense: an owner's drawing is not a
// business expense, so Gross/Net Profit are computed exactly as before —
// only the separate Drawing/Actual Net/Act % columns read it.
function plValues(sales: number, cogs: number, expense: number, drawing: number) {
  const gross = sales - cogs, net = gross - expense;
  const actualNet = net - drawing;
  return {
    revenue: sales, cogs, gross_profit: gross,
    gp_pct: sales !== 0 ? (gross / sales) * 100 : null,
    expense, net_profit: net,
    per_pct: sales !== 0 ? (net / sales) * 100 : null,
    drawing, actual_net: actualNet,
    act_pct: sales !== 0 ? (actualNet / sales) * 100 : null,
  };
}

const PL_COLS = [
  { key: "label", label: "Cost Centre / Group / Month" },
  { key: "revenue", label: "Revenue", kind: "money" as const, total: true },
  { key: "cogs", label: "COGS", kind: "money" as const, total: true },
  { key: "gross_profit", label: "Gross", kind: "money" as const, total: true },
  { key: "gp_pct", label: "GRS %", kind: "pct" as const, pctOf: { num: "gross_profit", den: "revenue" } },
  { key: "expense", label: "Expenses", kind: "money" as const, total: true },
  { key: "net_profit", label: "Net", kind: "money" as const, total: true },
  { key: "per_pct", label: "PER %", kind: "pct" as const, pctOf: { num: "net_profit", den: "revenue" } },
  { key: "drawing", label: "Drawing", kind: "money" as const, total: true },
  { key: "actual_net", label: "Actual Net", kind: "money" as const, total: true },
  { key: "act_pct", label: "Act %", kind: "pct" as const, pctOf: { num: "actual_net", den: "revenue" } },
];

// P&L Filteration is CC Group / Cost Center / Tag Area Group / Tag Area —
// four freely-combinable levels, nested in CLICK order (the same rule
// Expense Report's own Filteration follows: whichever is clicked first is
// outermost) — plus Month wise, additive on top of whatever the deepest
// active level is, and Year wise, which swaps the whole view to a flat
// This-Period-vs-Last-Year comparison and can't be combined with anything
// else (picking it clears the rest; picking anything else clears it).
// Tag Area was the one exclusive alternate to CC Group/Cost Center before
// 443 — report_pl_matrix() ended that: a journal line carries both a
// cost_center and a tag_area, so the two combine the same way Expense
// Report's cost-centre and account dimensions do.

// P&L — Income less cost of sales, less expenses. trial_balance() is
// unchanged and still the one verified source; report_pl_monthly() (424)
// applies the exact same income/COGS/expense classification this page's own
// summarize() already used, just grouped by month in one query.
// report_cost_centre_costing() (417) and report_tag_area_costing() (437)
// supply the Profit & Loss Summary's Group -> leaf -> Month drill, one RPC
// call each, reused across every filtration mode rather than refetched per
// mode; report_drawings() (416) supplies Drawings, so Actual Net (what is
// left after owner drawings) is not a new calculation, just Net Profit less
// a figure already reported elsewhere.
// Year+Months replaces the old From/To form; only the bounding {from,to}
// of the months picked is sent to every RPC (each takes one p_from/p_to
// pair, same as before) — last-month and same-period-last-year comparisons
// are still computed the same way, off whichever from/to that resolves to.
export default function ProfitLossView() {
  const sb = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);
  const [rows, setRows] = useState<any[]>(EMPTY_ARR);
  const [lmRows, setLmRows] = useState<any[]>(EMPTY_ARR);
  const [pyRows, setPyRows] = useState<any[]>(EMPTY_ARR);
  const [monthlyRaw, setMonthlyRaw] = useState<any[]>(EMPTY_ARR);
  const [ccData, setCcData] = useState<any[]>(EMPTY_ARR);
  const [plMatrixRaw, setPlMatrixRaw] = useState<MatrixRow[]>(EMPTY_ARR);
  const [drawings, setDrawings] = useState(0);
  // Per-month breakdown of the current period's own drawings — the same
  // report_drawings() call's `monthly` array, kept alongside the total so
  // the flat month-wise Profit & Loss Summary can show a real Drawing
  // figure per month instead of only a period total.
  const [drawingsMonthly, setDrawingsMonthly] = useState<{ month: string; amount: number }[]>(EMPTY_ARR);
  const [drawingsPy, setDrawingsPy] = useState(0);
  // Last Month / Current Month / Year to Date — three FIXED calendar windows
  // shown alongside whatever period the filter is set to, not a second
  // reading of it: "current month" here is always this actual month, "year
  // to date" always 1 Jan to today, regardless of what ym/from/to resolve to.
  const [cmRows, setCmRows] = useState<any[]>(EMPTY_ARR);
  const [ytdRows, setYtdRows] = useState<any[]>(EMPTY_ARR);
  const [drawingsLm, setDrawingsLm] = useState(0);
  const [drawingsCm, setDrawingsCm] = useState(0);
  const [drawingsYtd, setDrawingsYtd] = useState(0);
  const [loading, setLoading] = useState(true);
  // Click order = nesting order (see the comment above). Month wise and Year
  // wise are separate flags rather than members of the same array: Month
  // wise is additive on whatever the deepest active level is (or on the
  // flat month fallback when nothing is selected), and Year wise swaps the
  // whole panel to a different, non-nesting view.
  // Defaults to CC Group — the summary a viewer actually opens this report
  // for. This used to default to [] (the flat month-wise view) because
  // Drawing/Actual Net/Act % only ever showed in that one mode; now that
  // report_pl_matrix() attributes Drawing for real at every depth (see
  // plValues below), that reason is gone, and a single pre-selected
  // dimension is safe: startCollapsed only kicks in once a SECOND
  // dimension joins it (plDimOrder.length > 1), so CC Group alone still
  // opens straight to its own rows, nothing cascades.
  const [plDimOrder, setPlDimOrder] = useState<PLDim[]>(["ccGroup"]);
  const [monthWise, setMonthWise] = useState(false);
  const [yearWise, setYearWise] = useState(false);

  function toggleDim(key: PLDim) {
    setYearWise(false);
    setPlDimOrder((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  }
  function toggleMonthWise() {
    setYearWise(false);
    setMonthWise((v) => !v);
  }
  function toggleYearWise() {
    if (yearWise) { setYearWise(false); return; }
    setYearWise(true); setPlDimOrder([]); setMonthWise(false);
  }

  const ranges = monthRanges(ym);
  const from = ranges[0]?.from ?? `${ym.year}-01-01`;
  const to = ranges[ranges.length - 1]?.to ?? `${ym.year}-12-31`;

  useEffect(() => {
    let live = true;
    setLoading(true);
    const [lmFrom, lmTo] = lastMonthRange();
    const pyFrom = shiftYear(from, -1), pyTo = shiftYear(to, -1);
    const cmFrom = monthStartSA(), cmTo = todaySA();
    const ytdFrom = `${yearSA()}-01-01`, ytdTo = todaySA();
    const drawTotal = (d: any) => (d as any)?.total ? Number((d as any).total) : 0;
    Promise.all([
      sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: from, p_to: to }),
      sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: lmFrom, p_to: lmTo }),
      sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: pyFrom, p_to: pyTo }),
      sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: cmFrom, p_to: cmTo }),
      sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: ytdFrom, p_to: ytdTo }),
      sb.rpc("report_pl_monthly", { p_company: COMPANY_ID, p_from: from, p_to: to }),
      sb.rpc("report_cost_centre_costing", { p_from: from, p_to: to }),
      sb.rpc("report_pl_matrix", { p_from: from, p_to: to }),
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: from, p_to: to }),
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: lmFrom, p_to: lmTo }),
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: cmFrom, p_to: cmTo }),
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: ytdFrom, p_to: ytdTo }),
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: pyFrom, p_to: pyTo }),
    ]).then(([{ data }, { data: lmData }, { data: pyData }, { data: cmData }, { data: ytdData }, { data: monthlyData }, { data: ccD }, { data: matD },
      { data: drawingsData }, { data: drawLmData }, { data: drawCmData }, { data: drawYtdData }, { data: drawPyData }]) => {
      if (!live) return;
      setRows((data as any[]) ?? []);
      setLmRows((lmData as any[]) ?? []);
      setPyRows((pyData as any[]) ?? []);
      setCmRows((cmData as any[]) ?? []);
      setYtdRows((ytdData as any[]) ?? []);
      setMonthlyRaw((monthlyData as any[]) ?? []);
      setCcData((ccD as any[]) ?? []);
      setPlMatrixRaw((matD as any[]) ?? []);
      setDrawings(drawTotal(drawingsData));
      setDrawingsMonthly(((drawingsData as any)?.monthly as any[]) ?? []);
      setDrawingsLm(drawTotal(drawLmData));
      setDrawingsCm(drawTotal(drawCmData));
      setDrawingsYtd(drawTotal(drawYtdData));
      setDrawingsPy(drawTotal(drawPyData));
      setLoading(false);
    });
    return () => { live = false; };
  }, [sb, from, to]);

  const cur = summarize(rows);
  const lm = summarize(lmRows);
  const py = summarize(pyRows);
  const cm = summarize(cmRows);
  const ytd = summarize(ytdRows);
  const grossMargin = cur.totInc !== 0 ? (cur.gross / cur.totInc) * 100 : 0;
  const netMargin = cur.totInc !== 0 ? (cur.net / cur.totInc) * 100 : 0;
  const netChangeMonth = lm.net !== 0 ? ((cur.net - lm.net) / Math.abs(lm.net)) * 100 : null;
  const netChangeYear = py.net !== 0 ? ((cur.net - py.net) / Math.abs(py.net)) * 100 : null;
  const actualNet = cur.net - drawings;

  const monthly = monthlyRaw.map((m) => ({
    ...m, month_label: monthShort(m.month),
    gp_pct: Number(m.revenue) !== 0 ? (Number(m.gross_profit) / Number(m.revenue)) * 100 : 0,
  }));
  const ccRows = ccData.filter((r) => r.sales || r.cogs || r.expense || r.target);

  // Cost Center Profit & Loss (left panel) — one figure per Cost Centre
  // Group, red if negative, off the same ccRows the Summary panel's CC
  // Group mode aggregates — not a second calculation. Untouched by the
  // Filteration rebuild below: this panel is always this one fixed shape,
  // the same "always-there beside the filterable panel" role Expense
  // Report's own Cost Center Wise Expenses panel plays.
  const groupNet = new Map<string, number>();
  for (const r of ccRows) groupNet.set(r.cost_center_group, (groupNet.get(r.cost_center_group) ?? 0) + Number(r.net_profit || 0));
  const ccGroupNetRows = Array.from(groupNet.entries()).map(([name, net]) => ({ name, net })).sort((a, b) => b.net - a.net);
  const ccGroupNetTotal = ccGroupNetRows.reduce((s, r) => s + r.net, 0);

  const hasYear = yearWise;
  const plLevels = plDimOrder.map((k) => PL_LEVEL_BY_KEY.get(k)!);

  const drawingsByMonth = new Map(drawingsMonthly.map((r) => [r.month, Number(r.amount || 0)]));

  let plGroups: DataGroup[] | null = null;
  let plFlatRows: any[] | null = null;
  if (hasYear) {
    plFlatRows = [
      { label: "This Period", ...plValues(cur.totInc, cur.totCost, cur.totExp, drawings) },
      { label: "Same Period Last Year", ...plValues(py.totInc, py.totCost, py.totExp, drawingsPy) },
    ];
  } else if (plLevels.length > 0) {
    plGroups = buildPLLevels(plMatrixRaw, plLevels, monthWise);
  } else {
    plFlatRows = monthly.map((m) => ({ label: m.month_label, ...plValues(Number(m.revenue || 0), Number(m.cogs || 0), Number(m.expense || 0), drawingsByMonth.get(m.month) ?? 0) }));
  }
  // Remounts the DataTable when the active combination changes, so a group
  // key like "Trading" — flat under Cost Center alone, a group with
  // subgroups the moment Tag Area is also on — never opens pre-expanded
  // from a different shape's leftover state. Order matters (Cost
  // Center->Tag Area and Tag Area->Cost Center are different trees), so
  // this is plDimOrder in click order, not a sorted membership key.
  const plFilterKey = `${plDimOrder.join(",")}|${monthWise ? "m" : ""}${yearWise ? "y" : ""}`;

  return (
    <div className="space-y-4">
      <PageHeader title="Profit & Loss">
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PeriodBox title="Last Month" net={lm.net} drawings={drawingsLm} />
        <PeriodBox title="Current Month" net={cm.net} drawings={drawingsCm} />
        <PeriodBox title="Year to Date" net={ytd.net} drawings={drawingsYtd} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <ReportKpi label="Revenue" value={money(cur.totInc)} icon="sales" tone="info" />
        <ReportKpi label="Gross Margin %" value={pct(grossMargin)} icon="trendUp" tone={grossMargin >= 0 ? undefined : "neg"} />
        <ReportKpi label="Net Margin %" value={pct(netMargin)} icon="trendUp" tone={netMargin >= 0 ? "pos" : "neg"} />
        <ReportKpi label="Net vs Last Month" value={netChangeMonth === null ? "—" : `${netChangeMonth >= 0 ? "+" : ""}${netChangeMonth.toFixed(1)}%`}
          icon="trendUp" tone={netChangeMonth === null ? undefined : netChangeMonth >= 0 ? "pos" : "neg"} />
        <ReportKpi label="Net vs Last Year" value={netChangeYear === null ? "—" : `${netChangeYear >= 0 ? "+" : ""}${netChangeYear.toFixed(1)}%`}
          icon="trendUp" tone={netChangeYear === null ? undefined : netChangeYear >= 0 ? "pos" : "neg"} />
        <ReportKpi label="Drawings" value={money(drawings)} icon="wallet" />
        <ReportKpi label="Actual Net" value={money(actualNet)} icon="wallet" tone={actualNet >= 0 ? "pos" : "neg"} />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-brand-700 px-3 py-2 text-sm font-bold text-white">
          <span>Profit &amp; Loss Summary</span>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {PL_LEVELS.map((l) => {
              const idx = plDimOrder.indexOf(l.key);
              return (
                <button key={l.key} onClick={() => toggleDim(l.key)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${idx >= 0 ? "bg-white text-brand-700" : "bg-brand-600 text-white/80 hover:bg-brand-500"}`}>
                  {l.label}{idx >= 0 && plDimOrder.length > 1 ? ` ${idx + 1}` : ""}
                </button>
              );
            })}
            <button onClick={toggleMonthWise}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${monthWise ? "bg-white text-brand-700" : "bg-brand-600 text-white/80 hover:bg-brand-500"}`}>
              Month wise
            </button>
            <button onClick={toggleYearWise}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${yearWise ? "bg-white text-brand-700" : "bg-brand-600 text-white/80 hover:bg-brand-500"}`}>
              Year wise
            </button>
          </div>
        </div>
        {/* Keyed on the active combination (in click order for the
            dimensions) so DataTable remounts — and its own `expanded`
            state resets fresh to depth-0 — whenever Filteration changes.
            The same group KEY — "Trading", say — means a different shape
            under a different combination (a flat row under Cost Center
            alone, a group with subgroups once Tag Area is also on, or a
            different TREE entirely if the click order is reversed), so
            without this a key already in the old component instance's
            `expanded` Set carries straight into the next, making the new
            combination's children render already open (or the newly
            outermost level render collapsed) instead of fresh. */}
        <DataTable key={plFilterKey}
          bare roomy showGroupTotal cols={PL_COLS} startCollapsed={plDimOrder.length > 1}
          {...(plGroups ? { groups: plGroups } : { rows: plFlatRows ?? [] })} empty="No activity in this period." />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="overflow-hidden rounded-lg border border-slate-200 shadow-card">
          <div className="bg-brand-700 px-3 py-2 text-sm font-bold text-white">Cost Center Profit &amp; Loss</div>
          <table className="report-grid w-full text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr><th className="px-3 py-2 text-left"><span className="col-resize">Cost Center</span></th><th className="px-3 py-2 text-right"><span className="col-resize">P&amp;L</span></th></tr>
            </thead>
            <tbody>
              {ccGroupNetRows.map((r, i) => (
                <tr key={r.name} className={i % 2 === 1 ? "bg-slate-100/80" : ""}>
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${r.net < 0 ? "font-medium text-red-600" : ""}`}>{money(r.net)}</td>
                </tr>
              ))}
              {ccGroupNetRows.length === 0 && <tr><td colSpan={2} className="px-3 py-6 text-center text-slate-400">No activity.</td></tr>}
            </tbody>
            {ccGroupNetRows.length > 0 && (
              <tfoot><tr className="bg-slate-200 font-bold border-t-2 border-slate-400">
                <td className="px-3 py-1.5">Total</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${ccGroupNetTotal < 0 ? "bg-red-50 text-red-700" : ""}`}>{money(ccGroupNetTotal)}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
        {ccGroupNetRows.length > 0 && (
          <div className="card">
            <SectionHeader title="Cost Center Comparison" />
            <DonutChart data={ccGroupNetRows} nameKey="name" valueKey="net" height={240} />
          </div>
        )}
        <div className="card">
          <SectionHeader title="Profit & Loss Elements" />
          <ElementBar label="Revenue (P&L)" value={cur.totInc} basis={cur.totInc} tone="bg-brand-600" />
          <ElementBar label="Gross (P&L)" value={cur.gross} basis={cur.totInc} tone="bg-brand-400" />
          <ElementBar label="Expenses (P&L)" value={cur.totExp} basis={cur.totInc} tone="bg-amber-500" href="/accounting/targets?tab=exp" />
          <ElementBar label="Net (P&L)" value={cur.net} basis={cur.totInc} tone={cur.net >= 0 ? "bg-emerald-600" : "bg-red-600"} />
        </div>
        {monthly.length > 1 && (
          <div className="card">
            <SectionHeader title={`Monthwise Net Profit${loading ? " (loading…)" : ""}`} />
            <TrendChart data={monthly} xKey="month_label" series={[{ key: "net_profit", label: "Net Profit", redWhen: (v) => v < 0 }]} />
          </div>
        )}
      </div>
    </div>
  );
}
