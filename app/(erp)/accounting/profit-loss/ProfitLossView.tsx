"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { todaySA, yearSA, monthStartSA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import ReportKpi from "@/components/reports/ReportKpi";
import SectionHeader from "@/components/reports/SectionHeader";
import TrendChart from "@/components/reports/charts/TrendChart";
import DonutChart from "@/components/reports/charts/DonutChart";
import DataTable from "@/components/reports/DataTable";
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

// P&L — Income less cost of sales, less expenses. trial_balance() is
// unchanged and still the one verified source; report_pl_monthly() (424)
// applies the exact same income/COGS/expense classification this page's own
// summarize() already used, just grouped by month in one query.
// report_cost_centre_costing() (417) supplies the Cost Centre P&L /
// comparison section unchanged; report_drawings() (416) supplies Drawings,
// so Actual Net (what is left after owner drawings) is not a new
// calculation, just Net Profit less a figure already reported elsewhere.
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
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: from, p_to: to }),
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: lmFrom, p_to: lmTo }),
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: cmFrom, p_to: cmTo }),
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: ytdFrom, p_to: ytdTo }),
    ]).then(([{ data }, { data: lmData }, { data: pyData }, { data: cmData }, { data: ytdData }, { data: monthlyData }, { data: ccD },
      { data: drawingsData }, { data: drawLmData }, { data: drawCmData }, { data: drawYtdData }]) => {
      if (!live) return;
      setRows((data as any[]) ?? []);
      setLmRows((lmData as any[]) ?? []);
      setPyRows((pyData as any[]) ?? []);
      setCmRows((cmData as any[]) ?? []);
      setYtdRows((ytdData as any[]) ?? []);
      setMonthlyRaw((monthlyData as any[]) ?? []);
      setCcData((ccD as any[]) ?? []);
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

  const monthly = monthlyRaw.map((m) => ({ ...m, gp_pct: Number(m.revenue) !== 0 ? (Number(m.gross_profit) / Number(m.revenue)) * 100 : 0 }));
  const ccRows = ccData.filter((r) => r.sales || r.cogs || r.expense || r.target);

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

      <div className="grid gap-3 lg:grid-cols-2">
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
            <TrendChart data={monthly} xKey="month" series={[{ key: "net_profit", label: "Net Profit" }]} />
          </div>
        )}
      </div>

      <div>
        <SectionHeader title="Monthly P&L" />
        <DataTable
          cols={[
            { key: "month", label: "Month" },
            { key: "revenue", label: "Revenue", kind: "money", total: true },
            { key: "cogs", label: "COGS", kind: "money", total: true },
            { key: "gross_profit", label: "Gross Profit", kind: "money", total: true },
            { key: "gp_pct", label: "GP %", kind: "pct" },
            { key: "expense", label: "Expense", kind: "money", total: true },
            { key: "net_profit", label: "Net Profit", kind: "money", total: true },
          ]}
          rows={monthly} empty="No activity in this period." />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionHeader title="Cost Centre P&L" />
          <Link href="/accounting/cost-centre-costing" className="text-sm text-brand hover:underline">Full Cost Centre Costing report →</Link>
        </div>
        <DataTable
          cols={[
            { key: "cost_centre", label: "Cost Centre" },
            { key: "sales", label: "Sales", kind: "money", total: true },
            { key: "cogs", label: "COGS", kind: "money", total: true },
            { key: "gross_profit", label: "Gross Profit", kind: "money", total: true },
            { key: "gp_pct", label: "GP %", kind: "pct" },
            { key: "expense", label: "Expense", kind: "money", total: true },
            { key: "net_profit", label: "Net Profit", kind: "money", total: true },
          ]}
          rows={ccRows} empty="No cost centre activity in this period." />
      </div>

      {ccRows.length > 0 && (
        <div className="card">
          <SectionHeader title="Cost Centre Comparison" />
          <DonutChart data={ccRows} nameKey="cost_centre" valueKey="net_profit" height={260} />
        </div>
      )}
    </div>
  );
}
