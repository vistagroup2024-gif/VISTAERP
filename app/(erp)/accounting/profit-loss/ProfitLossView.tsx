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

// One P&L row shape shared by every filtration mode below — a plain object
// carrying whichever of these a mode has (a flat month/year row has no
// group/costCentre id to drill further into; a costing row does).
type CostRow = { name: string; group: string; sales: number; cogs: number; expense: number; monthly: { month: string; sales: number; cogs: number; expense: number }[] };

function plValues(sales: number, cogs: number, expense: number) {
  const gross = sales - cogs, net = gross - expense;
  return {
    revenue: sales, cogs, gross_profit: gross,
    gp_pct: sales !== 0 ? (gross / sales) * 100 : null,
    expense, net_profit: net,
    per_pct: sales !== 0 ? (net / sales) * 100 : null,
  };
}

// Group -> leaf -> Month, built once from either report_cost_centre_costing()
// or report_tag_area_costing() — same shape, same treatment, just a
// different source. `hasGroup`/`hasLeaf` pick the row hierarchy (Group only,
// leaf only, or Group -> leaf) and `withMonth` says whether the deepest level
// expands into its own months at all — these three are independent toggles
// in the UI (P&L Filteration), not one exclusive tab each, so a group with
// Month wise switched off has nothing to expand into and shows no chevron
// (DataTable itself only offers to expand a group that has children).
function buildCostingGroups(rows: CostRow[], opts: { hasGroup: boolean; hasLeaf: boolean; withMonth: boolean }): DataGroup[] {
  const { hasGroup, hasLeaf, withMonth } = opts;
  const byGroup = new Map<string, CostRow[]>();
  for (const r of rows) {
    const arr = byGroup.get(r.group) ?? [];
    arr.push(r);
    byGroup.set(r.group, arr);
  }
  const monthRows = (monthly: CostRow["monthly"]) =>
    [...monthly].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({
      label: monthShort(m.month), ...plValues(Number(m.sales || 0), Number(m.cogs || 0), Number(m.expense || 0)),
    }));
  function mergedMonths(rs: CostRow[]) {
    const merged = new Map<string, { month: string; sales: number; cogs: number; expense: number }>();
    for (const r of rs) for (const m of r.monthly) {
      const e = merged.get(m.month) ?? { month: m.month, sales: 0, cogs: 0, expense: 0 };
      e.sales += Number(m.sales || 0); e.cogs += Number(m.cogs || 0); e.expense += Number(m.expense || 0);
      merged.set(m.month, e);
    }
    return Array.from(merged.values());
  }

  if (hasGroup && !hasLeaf) {
    const groups: DataGroup[] = Array.from(byGroup.entries()).map(([group, leaves]) => {
      const gValues = plValues(leaves.reduce((s, r) => s + r.sales, 0), leaves.reduce((s, r) => s + r.cogs, 0), leaves.reduce((s, r) => s + r.expense, 0));
      return { key: group, label: group, values: gValues, rows: withMonth ? monthRows(mergedMonths(leaves)) : [] };
    });
    return groups.sort((a, b) => Number(b.values!.revenue) - Number(a.values!.revenue));
  }

  if (!hasGroup && hasLeaf) {
    const flat: DataGroup[] = rows.map((r) => ({
      key: r.name, label: r.name, values: plValues(r.sales, r.cogs, r.expense),
      rows: withMonth ? monthRows(r.monthly) : [],
    }));
    return flat.sort((a, b) => Number(b.values!.revenue) - Number(a.values!.revenue));
  }

  // hasGroup && hasLeaf — Group -> leaf, each leaf expanding into months only
  // when Month wise is also on.
  const groups: DataGroup[] = Array.from(byGroup.entries()).map(([group, leaves]) => {
    const gValues = plValues(leaves.reduce((s, r) => s + r.sales, 0), leaves.reduce((s, r) => s + r.cogs, 0), leaves.reduce((s, r) => s + r.expense, 0));
    const sortedLeaves = [...leaves].sort((a, b) => b.sales - a.sales);
    return {
      key: group, label: group, values: gValues, rows: [],
      subgroups: sortedLeaves.map((r) => ({
        key: `${group}::${r.name}`, label: r.name,
        values: plValues(r.sales, r.cogs, r.expense),
        rows: withMonth ? monthRows(r.monthly) : [],
      })),
    };
  });
  return groups.sort((a, b) => Number(b.values!.revenue) - Number(a.values!.revenue));
}

const PL_COLS = [
  { key: "label", label: "Cost Centre / Group / Month" },
  { key: "revenue", label: "Revenue", kind: "money" as const, total: true },
  { key: "cogs", label: "COGS", kind: "money" as const, total: true },
  { key: "gross_profit", label: "Gross", kind: "money" as const, total: true },
  { key: "gp_pct", label: "GRS %", kind: "pct" as const },
  { key: "expense", label: "Expenses", kind: "money" as const, total: true },
  { key: "net_profit", label: "Net", kind: "money" as const, total: true },
  { key: "per_pct", label: "PER %", kind: "pct" as const },
];

// The five P&L Filteration buttons are independent criteria, not one
// exclusive tab each — CC Group and Month wise are both real things a user
// wants to see together (Group -> Month), so this is a multi-select toggle
// group (the test this file's own multi-select-filter convention states),
// with three mutual-exclusion rules layered on because these particular
// options are not ALL freely combinable:
//  - Year wise swaps the whole view to a flat This-Period-vs-Last-Year
//    comparison and can't be combined with a grouping; picking it clears
//    everything else, and picking anything else clears it.
//  - Tag Area is an alternate SOURCE to CC Group/Cost Center (a different
//    dimension entirely, not an extra level within the same one), so it
//    clears them and they clear it.
//  - Month wise is additive on top of whichever grouping (or none) is
//    active — it never clears anything.
type PLMode = "ccGroup" | "costCenter" | "monthWise" | "yearWise" | "tagArea";
const PL_MODES: { key: PLMode; label: string }[] = [
  { key: "ccGroup", label: "CC Group" }, { key: "costCenter", label: "Cost Center" },
  { key: "monthWise", label: "Month wise" }, { key: "yearWise", label: "Year wise" }, { key: "tagArea", label: "Tag Area" },
];

function toggleMode(prev: Set<PLMode>, m: PLMode): Set<PLMode> {
  const next = new Set(prev);
  const turningOn = !next.has(m);
  if (m === "yearWise") {
    if (!turningOn) { if (next.size > 1) next.delete(m); return next; }
    return new Set<PLMode>(["yearWise"]);
  }
  next.delete("yearWise");
  if (turningOn) {
    next.add(m);
    if (m === "tagArea") { next.delete("ccGroup"); next.delete("costCenter"); }
    if (m === "ccGroup" || m === "costCenter") next.delete("tagArea");
  } else {
    if (next.size === 1) return next; // keep at least one selected
    next.delete(m);
  }
  return next;
}

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
  const [tagData, setTagData] = useState<any[]>(EMPTY_ARR);
  const [drawings, setDrawings] = useState(0);
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
  const [plModes, setPlModes] = useState<Set<PLMode>>(() => new Set<PLMode>(["ccGroup"]));

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
      sb.rpc("report_tag_area_costing", { p_from: from, p_to: to }),
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: from, p_to: to }),
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: lmFrom, p_to: lmTo }),
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: cmFrom, p_to: cmTo }),
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: ytdFrom, p_to: ytdTo }),
    ]).then(([{ data }, { data: lmData }, { data: pyData }, { data: cmData }, { data: ytdData }, { data: monthlyData }, { data: ccD }, { data: tagD },
      { data: drawingsData }, { data: drawLmData }, { data: drawCmData }, { data: drawYtdData }]) => {
      if (!live) return;
      setRows((data as any[]) ?? []);
      setLmRows((lmData as any[]) ?? []);
      setPyRows((pyData as any[]) ?? []);
      setCmRows((cmData as any[]) ?? []);
      setYtdRows((ytdData as any[]) ?? []);
      setMonthlyRaw((monthlyData as any[]) ?? []);
      setCcData((ccD as any[]) ?? []);
      setTagData((tagD as any[]) ?? []);
      setDrawings(drawTotal(drawingsData));
      setDrawingsLm(drawTotal(drawLmData));
      setDrawingsCm(drawTotal(drawCmData));
      setDrawingsYtd(drawTotal(drawYtdData));
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
  const tagRows = tagData.filter((r: any) => r.sales || r.cogs || r.expense);

  // Cost Center Profit & Loss (left panel) — one figure per Cost Centre
  // Group, red if negative, off the same ccRows the Summary panel's CC
  // Group mode aggregates — not a second calculation.
  const groupNet = new Map<string, number>();
  for (const r of ccRows) groupNet.set(r.cost_center_group, (groupNet.get(r.cost_center_group) ?? 0) + Number(r.net_profit || 0));
  const ccGroupNetRows = Array.from(groupNet.entries()).map(([name, net]) => ({ name, net })).sort((a, b) => b.net - a.net);
  const ccGroupNetTotal = ccGroupNetRows.reduce((s, r) => s + r.net, 0);

  // Profit & Loss Summary (right panel) — one dataset per filtration mode,
  // built off data already fetched above; switching modes never refetches.
  const ccCostRows: CostRow[] = ccRows.map((r) => ({ name: r.cost_centre, group: r.cost_center_group, sales: Number(r.sales || 0), cogs: Number(r.cogs || 0), expense: Number(r.expense || 0), monthly: r.monthly ?? [] }));
  const tagCostRows: CostRow[] = tagRows.map((r: any) => ({ name: r.tag_area, group: r.tag_area_group, sales: Number(r.sales || 0), cogs: Number(r.cogs || 0), expense: Number(r.expense || 0), monthly: r.monthly ?? [] }));

  const hasYear = plModes.has("yearWise");
  const hasTag = plModes.has("tagArea");
  const hasGroup = plModes.has("ccGroup");
  const hasLeaf = plModes.has("costCenter");
  const withMonth = plModes.has("monthWise");

  let plGroups: DataGroup[] | null = null;
  let plFlatRows: any[] | null = null;
  if (hasYear) {
    plFlatRows = [
      { label: "This Period", ...plValues(cur.totInc, cur.totCost, cur.totExp) },
      { label: "Same Period Last Year", ...plValues(py.totInc, py.totCost, py.totExp) },
    ];
  } else if (hasTag) {
    plGroups = buildCostingGroups(tagCostRows, { hasGroup: true, hasLeaf: true, withMonth });
  } else if (hasGroup || hasLeaf) {
    plGroups = buildCostingGroups(ccCostRows, { hasGroup, hasLeaf, withMonth });
  } else {
    plFlatRows = monthly.map((m) => ({ label: m.month_label, ...plValues(Number(m.revenue || 0), Number(m.cogs || 0), Number(m.expense || 0)) }));
  }

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

      <div className="grid gap-4 lg:grid-cols-[1fr_2.6fr]">
        <div className="overflow-hidden rounded-lg border border-slate-200 shadow-card">
          <div className="bg-brand-700 px-3 py-2 text-sm font-bold text-white">Cost Center Profit &amp; Loss</div>
          <table className="report-grid w-full text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr><th className="px-3 py-2 text-left"><span className="col-resize">Cost Center</span></th><th className="px-3 py-2 text-right"><span className="col-resize">P&amp;L</span></th></tr>
            </thead>
            <tbody>
              {ccGroupNetRows.map((r, i) => (
                <tr key={r.name} className={i % 2 === 1 ? "bg-slate-50/70" : ""}>
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${r.net < 0 ? "font-medium text-red-600" : ""}`}>{money(r.net)}</td>
                </tr>
              ))}
              {ccGroupNetRows.length === 0 && <tr><td colSpan={2} className="px-3 py-6 text-center text-slate-400">No activity.</td></tr>}
            </tbody>
            {ccGroupNetRows.length > 0 && (
              <tfoot><tr className="bg-slate-50 font-semibold">
                <td className="px-3 py-1.5">Total</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(ccGroupNetTotal)}</td>
              </tr></tfoot>
            )}
          </table>
        </div>

        <div>
          <div className="overflow-hidden rounded-lg border border-slate-200 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-brand-700 px-3 py-2 text-sm font-bold text-white">
              <span>Profit &amp; Loss Summary</span>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                {PL_MODES.map((m) => (
                  <button key={m.key} onClick={() => setPlModes((s) => toggleMode(s, m.key))}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${plModes.has(m.key) ? "bg-white text-brand-700" : "bg-brand-600 text-white/80 hover:bg-brand-500"}`}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <DataTable bare cols={PL_COLS} {...(plGroups ? { groups: plGroups } : { rows: plFlatRows ?? [] })} empty="No activity in this period." />
          </div>
          <p className="mt-1 text-right text-xs text-slate-400">
            <Link href="/accounting/cost-centre-costing" className="text-brand hover:underline">Full Cost Centre Costing report →</Link>
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
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
            <TrendChart data={monthly} xKey="month_label" series={[{ key: "net_profit", label: "Net Profit" }]} />
          </div>
        )}
      </div>
    </div>
  );
}
