"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { todaySA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import ReportKpi from "@/components/reports/ReportKpi";
import SectionHeader from "@/components/reports/SectionHeader";
import TrendChart from "@/components/reports/charts/TrendChart";
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

function Section({ title, sectionRows, total, from, to }: { title: string; sectionRows: any[]; total: number; from: string; to: string }) {
  return (
    <div className="card overflow-x-auto p-0">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-semibold text-slate-700">{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {sectionRows.map((r) => (
            <tr key={r.id} className="border-b border-slate-50">
              <td className="px-4 py-1.5"><Link href={`/accounting/ledger?account=${r.id}&from=${from}&to=${to}`} className="hover:text-brand hover:underline">{r.name}</Link></td>
              <td className="px-4 py-1.5 text-right tabular-nums">{money(r.amt)}</td>
            </tr>
          ))}
          {sectionRows.length === 0 && <tr><td className="px-4 py-3 text-slate-400">None</td><td /></tr>}
        </tbody>
        <tfoot><tr className="border-t-2 border-slate-200 font-semibold"><td className="px-4 py-2">Total {title}</td><td className="px-4 py-2 text-right tabular-nums">{money(total)}</td></tr></tfoot>
      </table>
    </div>
  );
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
  const [loading, setLoading] = useState(true);

  const ranges = monthRanges(ym);
  const from = ranges[0]?.from ?? `${ym.year}-01-01`;
  const to = ranges[ranges.length - 1]?.to ?? `${ym.year}-12-31`;

  useEffect(() => {
    let live = true;
    setLoading(true);
    const [lmFrom, lmTo] = lastMonthRange();
    const pyFrom = shiftYear(from, -1), pyTo = shiftYear(to, -1);
    Promise.all([
      sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: from, p_to: to }),
      sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: lmFrom, p_to: lmTo }),
      sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: pyFrom, p_to: pyTo }),
      sb.rpc("report_pl_monthly", { p_company: COMPANY_ID, p_from: from, p_to: to }),
      sb.rpc("report_cost_centre_costing", { p_from: from, p_to: to }),
      sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: from, p_to: to }),
    ]).then(([{ data }, { data: lmData }, { data: pyData }, { data: monthlyData }, { data: ccD }, { data: drawingsData }]) => {
      if (!live) return;
      setRows((data as any[]) ?? []);
      setLmRows((lmData as any[]) ?? []);
      setPyRows((pyData as any[]) ?? []);
      setMonthlyRaw((monthlyData as any[]) ?? []);
      setCcData((ccD as any[]) ?? []);
      setDrawings((drawingsData as any)?.total ? Number((drawingsData as any).total) : 0);
      setLoading(false);
    });
    return () => { live = false; };
  }, [sb, from, to]);

  const cur = summarize(rows);
  const lm = summarize(lmRows);
  const py = summarize(pyRows);
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

      {monthly.length > 1 && (
        <div className="card">
          <SectionHeader title={`Monthly P&L Trend${loading ? " (loading…)" : ""}`} />
          <TrendChart data={monthly} xKey="month" series={[{ key: "revenue", label: "Revenue" }, { key: "net_profit", label: "Net Profit" }]} />
        </div>
      )}

      <Section title="Income" sectionRows={cur.income} total={cur.totInc} from={from} to={to} />
      <Section title="Cost of Sales" sectionRows={cur.costs} total={cur.totCost} from={from} to={to} />
      <div className={`card flex items-center justify-between font-semibold ${cur.gross >= 0 ? "text-slate-800" : "text-red-700"}`}>
        <span>Gross {cur.gross >= 0 ? "Profit" : "Loss"}</span><span className="tabular-nums">{money(Math.abs(cur.gross))}</span>
      </div>
      <Section title="Expenses" sectionRows={cur.expense} total={cur.totExp} from={from} to={to} />
      <div className={`card flex items-center justify-between text-lg font-bold ${cur.net >= 0 ? "text-green-700" : "text-red-700"}`}>
        <span>Net {cur.net >= 0 ? "Profit" : "Loss"}</span><span className="tabular-nums">{money(Math.abs(cur.net))}</span>
      </div>
      {drawings !== 0 && (
        <div className="card flex items-center justify-between text-sm">
          <span className="text-slate-600">Less: Drawings</span><span className="tabular-nums text-slate-700">({money(drawings)})</span>
        </div>
      )}

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
    </div>
  );
}
