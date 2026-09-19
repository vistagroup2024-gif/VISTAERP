"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, monthShort } from "@/lib/format";
import { todaySA, monthStartSA, yearSA } from "@/lib/saudiTime";
import { defaultYearMonths, monthRanges, periodLabel, type YearMonths } from "@/lib/reports/period";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import ReportKpi from "@/components/reports/ReportKpi";
import SectionHeader from "@/components/reports/SectionHeader";
import TrendChart from "@/components/reports/charts/TrendChart";
import DataTable, { type DataGroup } from "@/components/reports/DataTable";

const money = (n: any) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

function pad(n: number) { return String(n).padStart(2, "0"); }
function lastMonthRange(): [string, string] {
  const t = todaySA(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return [`${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${pad(last)}`];
}

// One shape (name/group/expense/monthly) for all three pivot families — CC
// Group/Cost Center and Tag Area both already come off report_cost_centre_costing()
// and report_tag_area_costing() (reading only their `expense`/`monthly[].expense`
// fields — the P&L-shaped sales/cogs on those rows are ignored here), and
// Account Group/Account Name off the one genuinely new RPC this report
// needed, report_expense_by_account(). Converting all three into the same
// ExpRow shape means one builder produces every dimension's DataGroup[].
type ExpRow = { name: string; group: string; expense: number; monthly: { month: string; amount: number }[] };
function ccToExpRows(data: any[]): ExpRow[] {
  return (data ?? []).map((r) => ({
    name: r.cost_centre, group: r.cost_center_group, expense: Number(r.expense || 0),
    monthly: (r.monthly ?? []).map((m: any) => ({ month: m.month, amount: Number(m.expense || 0) })),
  }));
}
function tagToExpRows(data: any[]): ExpRow[] {
  return (data ?? []).map((r) => ({
    name: r.tag_area, group: r.tag_area_group, expense: Number(r.expense || 0),
    monthly: (r.monthly ?? []).map((m: any) => ({ month: m.month, amount: Number(m.expense || 0) })),
  }));
}
function acctToExpRows(data: any[]): ExpRow[] {
  return (data ?? []).map((r) => ({
    name: r.name, group: r.account_group, expense: Number(r.expense || 0),
    monthly: (r.monthly ?? []).map((m: any) => ({ month: m.month, amount: Number(m.amount || 0) })),
  }));
}

// Expenses Filteration — three mutually exclusive FAMILIES (the same
// layered-exclusion shape P&L Filteration already established): Account
// Group/Account Name are two levels of the account hierarchy, CC Group/Cost
// Center two levels of the cost-centre hierarchy, and Tag Area a third,
// alternate source — picking a button from a different family clears
// whichever family was active, picking a second button in the SAME family
// layers group+leaf together, and at least one button always stays on.
type ExpMode = "acctGroup" | "acctName" | "ccGroup" | "costCenter" | "tagArea";
type ExpFamily = "account" | "cc" | "tag";
const EXP_MODES: { key: ExpMode; label: string }[] = [
  { key: "acctGroup", label: "Account Group" }, { key: "acctName", label: "Account Name" },
  { key: "ccGroup", label: "CC Group" }, { key: "costCenter", label: "Cost Center" },
  { key: "tagArea", label: "Tag Area" },
];
const EXP_FAMILY: Record<ExpMode, ExpFamily> = {
  acctGroup: "account", acctName: "account", ccGroup: "cc", costCenter: "cc", tagArea: "tag",
};
function toggleExpMode(prev: Set<ExpMode>, m: ExpMode): Set<ExpMode> {
  const next = new Set(prev);
  const turningOn = !next.has(m);
  if (turningOn) {
    const fam = EXP_FAMILY[m];
    for (const k of Array.from(next)) if (EXP_FAMILY[k] !== fam) next.delete(k);
    next.add(m);
  } else if (next.size > 1) {
    next.delete(m);
  }
  return next;
}

// Group-only / leaf-only / group->leaf, the exact three-branch shape P&L's
// own buildCostingGroups() already uses — single metric here (`expense`)
// instead of a whole P&L row, so `values` carries just the one column.
function buildExpenseGroups(rows: ExpRow[], hasGroup: boolean, hasLeaf: boolean): DataGroup[] {
  const byGroup = new Map<string, ExpRow[]>();
  for (const r of rows) { const arr = byGroup.get(r.group) ?? []; arr.push(r); byGroup.set(r.group, arr); }
  if (hasGroup && !hasLeaf) {
    return Array.from(byGroup.entries()).map(([group, leaves]) => ({
      key: group, label: group, rows: [],
      values: { expense: leaves.reduce((s, r) => s + r.expense, 0) },
    })).sort((a, b) => Number(b.values!.expense) - Number(a.values!.expense));
  }
  if (!hasGroup && hasLeaf) {
    return rows.map((r) => ({ key: r.name, label: r.name, rows: [], values: { expense: r.expense } }))
      .sort((a, b) => Number(b.values!.expense) - Number(a.values!.expense));
  }
  return Array.from(byGroup.entries()).map(([group, leaves]) => ({
    key: group, label: group, rows: [],
    values: { expense: leaves.reduce((s, r) => s + r.expense, 0) },
    subgroups: [...leaves].sort((a, b) => b.expense - a.expense).map((r) => ({
      key: `${group}::${r.name}`, label: r.name, rows: [], values: { expense: r.expense },
    })),
  })).sort((a, b) => Number(b.values!.expense) - Number(a.values!.expense));
}

// Current vs Last Month — merged by name (a name in one period and not the
// other still gets a row, reading 0 on the side it's missing from), then
// the same group-only/leaf-only/group->leaf shape as buildExpenseGroups.
// Variance follows the same "reference minus actual" direction Budget's own
// Variance already uses (budget - actual, positive = under budget = good =
// green) — here `last_month - current`, so spending LESS than last month
// reads positive/green (a genuine improvement for an expense) and spending
// MORE reads negative/red, never the Sales Report "actual - reference"
// direction, which would be backwards for a figure where less is better.
type CmpRow = { name: string; group: string; current: number; last_month: number; variance: number };
function lastVsCurrent(curRows: ExpRow[], lastRows: ExpRow[]): CmpRow[] {
  const curMap = new Map(curRows.map((r) => [r.name, r]));
  const lastMap = new Map(lastRows.map((r) => [r.name, r]));
  const names = new Set([...Array.from(curMap.keys()), ...Array.from(lastMap.keys())]);
  return Array.from(names).map((name) => {
    const cur = curMap.get(name), last = lastMap.get(name);
    const current = cur?.expense ?? 0, last_month = last?.expense ?? 0;
    return { name, group: cur?.group ?? last?.group ?? name, current, last_month, variance: last_month - current };
  }).filter((r) => r.current !== 0 || r.last_month !== 0);
}
function buildComparisonGroups(rows: CmpRow[], hasGroup: boolean, hasLeaf: boolean): DataGroup[] {
  const byGroup = new Map<string, CmpRow[]>();
  for (const r of rows) { const arr = byGroup.get(r.group) ?? []; arr.push(r); byGroup.set(r.group, arr); }
  const agg = (rs: CmpRow[]) => ({
    current: rs.reduce((s, r) => s + r.current, 0), last_month: rs.reduce((s, r) => s + r.last_month, 0),
    variance: rs.reduce((s, r) => s + r.variance, 0),
  });
  if (hasGroup && !hasLeaf) {
    return Array.from(byGroup.entries()).map(([group, leaves]) => ({ key: group, label: group, rows: [], values: agg(leaves) }))
      .sort((a, b) => Number(b.values!.current) - Number(a.values!.current));
  }
  if (!hasGroup && hasLeaf) {
    return rows.map((r) => ({ key: r.name, label: r.name, rows: [], values: { current: r.current, last_month: r.last_month, variance: r.variance } }))
      .sort((a, b) => Number(b.values!.current) - Number(a.values!.current));
  }
  return Array.from(byGroup.entries()).map(([group, leaves]) => ({
    key: group, label: group, rows: [], values: agg(leaves),
    subgroups: [...leaves].sort((a, b) => b.current - a.current).map((r) => ({
      key: `${group}::${r.name}`, label: r.name, rows: [], values: { current: r.current, last_month: r.last_month, variance: r.variance },
    })),
  })).sort((a, b) => Number(b.values!.current) - Number(a.values!.current));
}

// Monthwise Expenses — the same hand-rolled month-columns pivot Sales
// Report's own MonthwisePivotTable uses (a two-row month header isn't
// expressible in DataTable's generic Col system), simplified to one metric
// per month (Expenses has no Value/Qty split the way Sales does) with a
// Total column, and starting collapsed like every grouped table now does.
type PivotRow = { key: string; label: string; cells: Record<string, number>; total: number };
function buildPivotRows(rows: ExpRow[]): PivotRow[] {
  return rows.map((r) => {
    const cells: Record<string, number> = {};
    let total = 0;
    for (const m of r.monthly) { cells[m.month] = m.amount; total += m.amount; }
    return { key: r.name, label: r.name, cells, total };
  }).sort((a, b) => b.total - a.total);
}
function ExpenseMonthwisePivot({ rows, group, monthKeys }: { rows: ExpRow[]; group: string | null; monthKeys: string[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const byGroup = useMemo(() => {
    const m = new Map<string, ExpRow[]>();
    for (const r of rows) { const arr = m.get(r.group) ?? []; arr.push(r); m.set(r.group, arr); }
    return m;
  }, [rows]);
  const groups = group === null
    ? [{ key: "__flat__", label: null as string | null, rows: buildPivotRows(rows) }]
    : Array.from(byGroup.entries()).map(([g, rs]) => ({ key: g, label: g, rows: buildPivotRows(rs) }));
  const colCount = monthKeys.length + 2;
  function toggle(k: string) { setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; }); }

  return (
    <div className="card overflow-x-auto p-0 text-sm">
      <table className="report-grid w-full">
        <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
          <tr>
            <th className="px-3 py-2 text-left"><span className="col-resize">Name</span></th>
            {monthKeys.map((mk) => <th key={mk} className="px-2 py-2 text-right"><span className="col-resize">{monthShort(mk)}</span></th>)}
            <th className="px-2 py-2 text-right"><span className="col-resize">Total</span></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, gi) => {
            const isFlat = g.label === null;
            const open = isFlat || expanded.has(g.key);
            const grandTotal = g.rows.reduce((s, r) => s + r.total, 0);
            return (
              <Fragment key={g.key}>
                {!isFlat && (
                  <tr className={`cursor-pointer font-semibold ${gi % 2 === 1 ? "bg-slate-50/70" : ""}`} onClick={() => toggle(g.key)}>
                    <td colSpan={colCount} className="border border-slate-200 px-3 py-2">
                      <span className="mr-1.5 inline-block w-3 text-slate-400">{open ? "▾" : "▸"}</span>
                      {g.label}
                      <span className="ml-2 font-normal text-slate-500">— {money(grandTotal)}</span>
                    </td>
                  </tr>
                )}
                {open && g.rows.map((row, i) => (
                  <tr key={row.key} className={i % 2 === 1 ? "bg-slate-50/70" : ""}>
                    <td className="px-3 py-1.5" style={{ paddingLeft: isFlat ? 12 : 28 }}>{row.label}</td>
                    {monthKeys.map((mk) => (
                      <td key={mk} className="px-2 py-1.5 text-right tabular-nums">{row.cells[mk] ? money(row.cells[mk]) : "—"}</td>
                    ))}
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums">{money(row.total)}</td>
                  </tr>
                ))}
                {open && g.rows.length === 0 && (
                  <tr><td colSpan={colCount} className="px-3 py-4 text-center text-slate-400">No expenses in this period.</td></tr>
                )}
              </Fragment>
            );
          })}
          {groups.length === 0 && <tr><td colSpan={colCount} className="px-3 py-6 text-center text-slate-400">No expenses in this period.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const CMP_COLS = [
  { key: "name", label: "Group Name" },
  { key: "current", label: "Current", kind: "money" as const, total: true },
  { key: "last_month", label: "Last Month", kind: "money" as const, total: true },
  { key: "variance", label: "Variance", kind: "money" as const, total: true },
];

// Expense Report — the old software's "Expenses Detail" dashboard, rebuilt
// on this ERP's own report system (dark-green section headers, DataTable's
// group/values shape, PeriodDropdown, the multi-select-with-layered-
// exclusion filtration convention P&L already established) rather than
// copied pixel-for-pixel. report_cost_centre_costing()/report_tag_area_costing()
// already carry a COGS-excluded `expense` figure per cost centre/tag area —
// the same definition dashboard_metrics()'s own Expenses card uses — so
// only the Account Group/Account Name dimension needed a new RPC
// (report_expense_by_account, 440). The Monthly and Yearly Budgets panel is
// a genuinely new feature: acct_expense_budgets (249, the existing
// "Expense Budget" tab on Targets & Budget) has no cost-centre split at
// all, so acct_expense_budgets_cc (440) is a real, additive, cost-centre-
// and-account-wise recurring MONTHLY budget (Yearly = Monthly x 12,
// verified against the old software's own screenshot numbers) — the old
// tab and its budget are left exactly as they were, a separate, simpler
// figure that predates this report.
export default function ExpenseReportView() {
  const sb = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);
  const [expMode, setExpMode] = useState<Set<ExpMode>>(() => new Set<ExpMode>(["acctGroup"]));

  const [monthly, setMonthly] = useState<{ month: string; amount: number }[]>([]);
  const [lastMonthTotal, setLastMonthTotal] = useState(0);
  const [curMonthTotal, setCurMonthTotal] = useState(0);
  const [ytdTotal, setYtdTotal] = useState(0);

  const [ccPeriod, setCcPeriod] = useState<any[]>([]);
  const [tagPeriod, setTagPeriod] = useState<any[]>([]);
  const [acctPeriod, setAcctPeriod] = useState<any[]>([]);
  const [ccLast, setCcLast] = useState<any[]>([]);
  const [ccCur, setCcCur] = useState<any[]>([]);
  const [tagLast, setTagLast] = useState<any[]>([]);
  const [tagCur, setTagCur] = useState<any[]>([]);
  const [acctLast, setAcctLast] = useState<any[]>([]);
  const [acctCur, setAcctCur] = useState<any[]>([]);

  const [budgetRows, setBudgetRows] = useState<any[]>([]);
  const [budgetDraft, setBudgetDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const ranges = monthRanges(ym);
  const from = ranges[0]?.from ?? `${ym.year}-01-01`;
  const to = ranges[ranges.length - 1]?.to ?? `${ym.year}-12-31`;
  const periodTxt = periodLabel(ym);

  async function loadBudget() {
    const { data } = await sb.rpc("report_expense_budget_cc", { p_year: ym.year });
    setBudgetRows((data as any[]) ?? []);
  }

  useEffect(() => {
    let live = true;
    setLoading(true);
    const [lmFrom, lmTo] = lastMonthRange();
    const cmFrom = monthStartSA(), today = todaySA();
    const ytdFrom = `${yearSA()}-01-01`;
    Promise.all([
      sb.rpc("report_expense_analysis", { p_company: COMPANY_ID, p_from: from, p_to: to }),
      sb.rpc("report_expense_analysis", { p_company: COMPANY_ID, p_from: lmFrom, p_to: lmTo }),
      sb.rpc("report_expense_analysis", { p_company: COMPANY_ID, p_from: cmFrom, p_to: today }),
      sb.rpc("report_expense_analysis", { p_company: COMPANY_ID, p_from: ytdFrom, p_to: today }),
      sb.rpc("report_cost_centre_costing", { p_from: from, p_to: to }),
      sb.rpc("report_tag_area_costing", { p_from: from, p_to: to }),
      sb.rpc("report_expense_by_account", { p_from: from, p_to: to }),
      sb.rpc("report_cost_centre_costing", { p_from: lmFrom, p_to: lmTo }),
      sb.rpc("report_cost_centre_costing", { p_from: cmFrom, p_to: today }),
      sb.rpc("report_tag_area_costing", { p_from: lmFrom, p_to: lmTo }),
      sb.rpc("report_tag_area_costing", { p_from: cmFrom, p_to: today }),
      sb.rpc("report_expense_by_account", { p_from: lmFrom, p_to: lmTo }),
      sb.rpc("report_expense_by_account", { p_from: cmFrom, p_to: today }),
      sb.rpc("report_expense_budget_cc", { p_year: ym.year }),
    ]).then(([main, lm, cm, ytd, cc, tag, acct, ccL, ccC, tagL, tagC, acctL, acctC, budget]) => {
      if (!live) return;
      setMonthly(((main.data as any)?.monthly as any[]) ?? []);
      setLastMonthTotal(Number((lm.data as any)?.total ?? 0));
      setCurMonthTotal(Number((cm.data as any)?.total ?? 0));
      setYtdTotal(Number((ytd.data as any)?.total ?? 0));
      setCcPeriod((cc.data as any[]) ?? []);
      setTagPeriod((tag.data as any[]) ?? []);
      setAcctPeriod((acct.data as any[]) ?? []);
      setCcLast((ccL.data as any[]) ?? []);
      setCcCur((ccC.data as any[]) ?? []);
      setTagLast((tagL.data as any[]) ?? []);
      setTagCur((tagC.data as any[]) ?? []);
      setAcctLast((acctL.data as any[]) ?? []);
      setAcctCur((acctC.data as any[]) ?? []);
      setBudgetRows((budget.data as any[]) ?? []);
      setBudgetDraft({});
      setLoading(false);
    });
    return () => { live = false; };
  }, [sb, from, to, ym.year]);

  async function saveBudgetCell(accountId: string, costCenterId: string) {
    const key = `${accountId}::${costCenterId}`;
    const v = budgetDraft[key];
    if (v === undefined) return;
    await sb.from("acct_expense_budgets_cc").upsert(
      { company_id: COMPANY_ID, account_id: accountId, cost_center_id: costCenterId, year: ym.year, monthly_amount: Number(v) || 0 },
      { onConflict: "company_id,account_id,cost_center_id,year" });
    loadBudget();
  }

  const family: ExpFamily = expMode.has("tagArea") ? "tag" : (expMode.has("ccGroup") || expMode.has("costCenter")) ? "cc" : "account";
  const hasGroup = family === "tag" ? true : family === "account" ? expMode.has("acctGroup") : expMode.has("ccGroup");
  const hasLeaf = family === "tag" ? true : family === "account" ? expMode.has("acctName") : expMode.has("costCenter");

  const periodRowsByFamily: Record<ExpFamily, ExpRow[]> = {
    account: acctToExpRows(acctPeriod), cc: ccToExpRows(ccPeriod), tag: tagToExpRows(tagPeriod),
  };
  const lastRowsByFamily: Record<ExpFamily, ExpRow[]> = {
    account: acctToExpRows(acctLast), cc: ccToExpRows(ccLast), tag: tagToExpRows(tagLast),
  };
  const curRowsByFamily: Record<ExpFamily, ExpRow[]> = {
    account: acctToExpRows(acctCur), cc: ccToExpRows(ccCur), tag: tagToExpRows(tagCur),
  };

  const comparisonRows = lastVsCurrent(curRowsByFamily[family], lastRowsByFamily[family]);
  const comparisonGroups = buildComparisonGroups(comparisonRows, hasGroup, hasLeaf);

  const selectedMonths = Array.from(new Set(ym.months)).sort((a, b) => a - b);
  const monthKeys = selectedMonths.map((m) => `${ym.year}-${pad(m)}`);
  const pivotRows = periodRowsByFamily[family];
  const pivotGroup = hasGroup ? (hasLeaf ? "group" : "flat") : (hasLeaf ? null : "flat");

  // Cost Center Wise Expenses — a fixed panel, always by cost-centre GROUP
  // regardless of the Filteration selection, the same "always-there" shape
  // P&L's own Cost Center Profit & Loss panel keeps beside its own
  // filterable Summary panel.
  const ccGroupTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ccToExpRows(ccPeriod)) m.set(r.group, (m.get(r.group) ?? 0) + r.expense);
    return Array.from(m.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }, [ccPeriod]);

  // Monthly Expense Graph — a month reads red when it ran ABOVE the
  // period's own average expense, not on sign (an expense total is never
  // negative in the ordinary case) — verified against the old software's
  // own screenshot: every month it colored red (Mar/Jun/Jul) was genuinely
  // above that period's average, every green month at or below it.
  const monthlyChart = monthly.map((m) => ({ ...m, month_label: monthShort(m.month), amount: Number(m.amount || 0) }));
  const monthlyAvg = monthlyChart.length > 0 ? monthlyChart.reduce((s, m) => s + m.amount, 0) / monthlyChart.length : 0;

  // Budget vs Expenses — bounded to the SAME [from, to] window as the rest
  // of the page: the budget matrix's own monthly_amount is a flat recurring
  // figure (period-independent, always shown as Monthly/Yearly), but the
  // KPI here multiplies it by however many months are actually selected so
  // it stays comparable to Expense (this period's real actual), rather than
  // always comparing a full year's budget against a partial period's spend.
  const totalMonthlyBudget = budgetRows.reduce((s, r) => s + Number(r.monthly_amount || 0), 0);
  const budgetForPeriod = totalMonthlyBudget * selectedMonths.length;
  const expenseForPeriod = monthlyChart.reduce((s, m) => s + m.amount, 0);
  const varianceForPeriod = budgetForPeriod - expenseForPeriod;
  const usedPct = budgetForPeriod > 0 ? (expenseForPeriod / budgetForPeriod) * 100 : null;

  // Monthly and Yearly Budgets matrix — every postable expense account
  // against every leaf cost centre (report_expense_budget_cc already
  // returns the full cross product), pivoted client-side into rows x
  // columns the same way MonthwisePivotTable pivots months.
  const budgetAccounts = useMemo(() => {
    const m = new Map<string, { id: string; name: string; group: string }>();
    for (const r of budgetRows) if (!m.has(r.account_id)) m.set(r.account_id, { id: r.account_id, name: r.account_name, group: r.account_group });
    return Array.from(m.values()).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  }, [budgetRows]);
  const budgetCostCentres = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const r of budgetRows) if (!m.has(r.cost_center_id)) m.set(r.cost_center_id, { id: r.cost_center_id, name: r.cost_center });
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [budgetRows]);
  const budgetCell = useMemo(() => new Map(budgetRows.map((r) => [`${r.account_id}::${r.cost_center_id}`, Number(r.monthly_amount || 0)])), [budgetRows]);

  return (
    <div className="space-y-4">
      <PageHeader title="Expenses">
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Summary — {periodTxt}{loading ? " (loading…)" : ""}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <ReportKpi label="Last Month" value={money(lastMonthTotal)} icon="receipt" />
          <ReportKpi label="Current Month" value={money(curMonthTotal)} icon="receipt" />
          <ReportKpi label="Year to Date" value={money(ytdTotal)} icon="receipt" />
          <ReportKpi label={`Budget — ${periodTxt}`} value={money(budgetForPeriod)} icon="wallet" />
          <ReportKpi label={`Expense — ${periodTxt}`} value={money(expenseForPeriod)} icon="wallet" tone="info" />
          <ReportKpi label="Variance" value={money(varianceForPeriod)} icon="wallet" tone={varianceForPeriod >= 0 ? "pos" : "neg"} />
          <ReportKpi label="Used %" value={usedPct === null ? "No budget set" : `${usedPct.toFixed(1)}%`} icon="trendUp"
            tone={usedPct === null ? undefined : usedPct > 100 ? "neg" : usedPct > 85 ? "warn" : "pos"} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <SectionHeader title="Cost Center Wise Expenses" />
          <DataTable bare cols={[
            { key: "name", label: "Group Name" },
            { key: "amount", label: "Amount", kind: "money", total: true },
          ]} rows={ccGroupTotals} empty="No expenses in this period." />
        </div>
        <div className="card">
          <SectionHeader title="Monthly Expense Graph" />
          <TrendChart data={monthlyChart} xKey="month_label" series={[{ key: "amount", label: "Expense", redWhen: (v) => v > monthlyAvg }]} />
        </div>
      </div>

      {/* Expenses Filteration — Account Group/Account Name and CC Group/Cost
          Center each layer together within their own family; Tag Area is
          the exclusive third source. Governs the two panels below. */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Expenses Filteration</span>
        <div className="flex flex-wrap gap-1">
          {EXP_MODES.map((m) => (
            <button key={m.key} onClick={() => setExpMode((s) => toggleExpMode(s, m.key))}
              className={`rounded-full px-3 py-1 text-sm ${expMode.has(m.key) ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Both tables below are keyed on the active Filteration selection so
          they remount (and their own expand state resets to collapsed)
          whenever it changes — the same fix P&L's own mode toggle needed:
          a group key like "Trading" is a flat row under CC Group alone but
          gains subgroups once Cost Center is also switched on, so without
          a fresh remount a key already expanded under the old shape opens
          pre-expanded under the new one. ExpenseMonthwisePivot needs it for
          the same reason even though it isn't a DataTable — it keeps its
          own local `expanded` state, which is exactly as stale otherwise. */}
      <div>
        <SectionHeader title="Last vs Current Month Comparison" />
        <DataTable key={Array.from(expMode).sort().join(",")} cols={CMP_COLS} groups={comparisonGroups} empty="No expenses to compare." />
      </div>

      {monthKeys.length > 1 && (
        <div>
          <SectionHeader title="Monthwise Expenses" />
          <ExpenseMonthwisePivot key={Array.from(expMode).sort().join(",")} rows={pivotRows} group={pivotGroup} monthKeys={monthKeys} />
        </div>
      )}

      <div>
        <SectionHeader title={`Monthly and Yearly Budgets — ${ym.year}`} />
        <div className="card overflow-x-auto p-0 text-sm">
          <table className="report-grid w-full">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr>
                <th className="px-3 py-2 text-left" rowSpan={2}><span className="col-resize">Account</span></th>
                {budgetCostCentres.map((cc) => (
                  <th key={cc.id} className="px-2 py-2 text-center" colSpan={2}><span className="col-resize-wrap">{cc.name}</span></th>
                ))}
                <th className="px-2 py-2 text-center" colSpan={2}><span className="col-resize">Total</span></th>
              </tr>
              <tr>
                {budgetCostCentres.map((cc) => (
                  <Fragment key={cc.id}>
                    <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Monthly</span></th>
                    <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Yearly</span></th>
                  </Fragment>
                ))}
                <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Monthly</span></th>
                <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Yearly</span></th>
              </tr>
            </thead>
            <tbody>
              {budgetAccounts.map((acc, i) => {
                const rowTotal = budgetCostCentres.reduce((s, cc) => s + (budgetCell.get(`${acc.id}::${cc.id}`) ?? 0), 0);
                return (
                  <tr key={acc.id} className={i % 2 === 1 ? "bg-slate-50/70" : ""}>
                    <td className="px-3 py-1.5">
                      <span className="mr-1 text-slate-400">{acc.group}</span>
                      {acc.name}
                    </td>
                    {budgetCostCentres.map((cc) => {
                      const key = `${acc.id}::${cc.id}`;
                      const val = budgetCell.get(key) ?? 0;
                      return (
                        <Fragment key={cc.id}>
                          <td className="px-1 py-1 text-right">
                            <input className="input w-20 text-right tabular-nums" inputMode="decimal"
                              value={budgetDraft[key] ?? String(val)}
                              onChange={(e) => setBudgetDraft((d) => ({ ...d, [key]: e.target.value }))}
                              onBlur={() => saveBudgetCell(acc.id, cc.id)} />
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{money(val * 12)}</td>
                        </Fragment>
                      );
                    })}
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums">{money(rowTotal)}</td>
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums">{money(rowTotal * 12)}</td>
                  </tr>
                );
              })}
              {budgetAccounts.length === 0 && (
                <tr><td colSpan={budgetCostCentres.length * 2 + 3} className="px-3 py-6 text-center text-slate-400">No expense accounts or cost centres.</td></tr>
              )}
            </tbody>
            {budgetAccounts.length > 0 && (
              <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td className="px-3 py-1.5">Total</td>
                {budgetCostCentres.map((cc) => {
                  const colTotal = budgetAccounts.reduce((s, acc) => s + (budgetCell.get(`${acc.id}::${cc.id}`) ?? 0), 0);
                  return (
                    <Fragment key={cc.id}>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(colTotal)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(colTotal * 12)}</td>
                    </Fragment>
                  );
                })}
                <td className="px-2 py-1.5 text-right tabular-nums">{money(totalMonthlyBudget)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(totalMonthlyBudget * 12)}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          A recurring monthly budget per account and cost centre — Yearly is always Monthly × 12. Separate from the
          simpler per-account annual budget on Accounting → Targets & Budget → Expense Budget, which this does not replace.
        </p>
      </div>
    </div>
  );
}
