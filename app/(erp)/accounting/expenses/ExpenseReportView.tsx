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
function groupByField<T>(rows: T[], field: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = field(r); const arr = m.get(k) ?? []; arr.push(r); m.set(k, arr); }
  return m;
}

// report_expense_matrix() (441, extended by 442 to also carry tag_area) —
// one row per (cost centre, account, tag area, month), carrying every
// dimension's id/name/group at once. This is what makes "whichever
// combination you want, in whichever order you want" possible: CC Group,
// Cost Center, Account Group, Account Name, Tag Area Group and Tag Area are
// six independent, freely-combinable levels of the SAME rows, not separate
// per-dimension datasets you pick one family of (that was the bug in the
// first cut of this report) and not one of them held back as a forced
// exclusive alternate (442 folded Tag Area — previously its own
// report_tag_area_costing() call, mutually exclusive with the other four —
// into this same matrix, because the owner wants it combinable too).
type MatrixRow = {
  cost_center_id: string | null; cost_center: string; cost_center_group: string;
  account_id: string; account: string; account_group: string;
  tag_area_id: string | null; tag_area: string; tag_area_group: string;
  month: string; amount: number;
};
type ExpMode = "ccGroup" | "costCenter" | "acctGroup" | "acctName" | "tagAreaGroup" | "tagArea";
type Level = { key: ExpMode; label: string; field: (r: MatrixRow) => string };
// The six selectable levels, in the fixed order they're offered as buttons.
// This is NOT the nesting order any more — nesting order is whichever order
// the user actually clicked them in (see expModeOrder below): "select Cost
// Center then Account Name" nests Account Name under Cost Center; clicking
// the same two the other way round nests Cost Center under Account Name.
const ALL_LEVELS: Level[] = [
  { key: "ccGroup", label: "CC Group", field: (r) => r.cost_center_group },
  { key: "costCenter", label: "Cost Center", field: (r) => r.cost_center },
  { key: "acctGroup", label: "Account Group", field: (r) => r.account_group },
  { key: "acctName", label: "Account Name", field: (r) => r.account },
  { key: "tagAreaGroup", label: "Tag Area Group", field: (r) => r.tag_area_group },
  { key: "tagArea", label: "Tag Area", field: (r) => r.tag_area },
];
const LEVEL_BY_KEY = new Map(ALL_LEVELS.map((l) => [l.key, l]));
const EXP_MODES = ALL_LEVELS.map((l) => ({ key: l.key, label: l.label }));
// Click order IS nesting order, so the active selection is an ordered
// array, not a Set — the newest click goes on the end (innermost), an
// existing one clicked again drops out but the relative order of the rest
// is preserved. At least one level must stay selected, same "keep at least
// one on" rule every other multi-select toggle group in this ERP follows.
function toggleExpMode(prev: ExpMode[], m: ExpMode): ExpMode[] {
  if (prev.includes(m)) return prev.length > 1 ? prev.filter((k) => k !== m) : prev;
  return [...prev, m];
}

// Group-only / leaf-only / any N-level combination — one recursive builder
// instead of P&L's fixed three-branch shape, since up to four levels can
// now be active at once instead of at most two.
function buildExpenseLevels(rows: MatrixRow[], levels: Level[], depth = 0): DataGroup[] {
  if (depth >= levels.length) return [];
  const byKey = groupByField(rows, levels[depth].field);
  const isLast = depth === levels.length - 1;
  return Array.from(byKey.entries()).map(([key, rs]) => ({
    key: `${depth}:${key}`, label: key, rows: [] as any[],
    values: { expense: rs.reduce((s, r) => s + r.amount, 0) },
    ...(isLast ? {} : { subgroups: buildExpenseLevels(rs, levels, depth + 1) }),
  })).sort((a, b) => Number(b.values!.expense) - Number(a.values!.expense));
}

// Current vs Last Month — groups current-period and last-month rows
// SIMULTANEOUSLY by the same key at each level (rather than building two
// trees and merging), so a name only in one period still gets a row,
// reading 0 on the side it's missing from. Variance follows the same
// "reference minus actual" direction Budget's own Variance already uses
// (budget - actual, positive = under budget = good = green) — here
// `last_month - current`, so spending LESS than last month reads
// positive/green (a genuine improvement for an expense) and spending MORE
// reads negative/red — never the Sales Report "actual - reference"
// direction, which would be backwards for a figure where less is better.
function buildComparisonLevels(curRows: MatrixRow[], lastRows: MatrixRow[], levels: Level[], depth = 0): DataGroup[] {
  if (depth >= levels.length) return [];
  const field = levels[depth].field;
  const curByKey = groupByField(curRows, field);
  const lastByKey = groupByField(lastRows, field);
  const keys = new Set([...Array.from(curByKey.keys()), ...Array.from(lastByKey.keys())]);
  const isLast = depth === levels.length - 1;
  return Array.from(keys).map((key) => {
    const curRs = curByKey.get(key) ?? [], lastRs = lastByKey.get(key) ?? [];
    const current = curRs.reduce((s, r) => s + r.amount, 0);
    const last_month = lastRs.reduce((s, r) => s + r.amount, 0);
    return {
      key: `${depth}:${key}`, label: key, rows: [] as any[],
      values: { current, last_month, variance: last_month - current },
      ...(isLast ? {} : { subgroups: buildComparisonLevels(curRs, lastRs, levels, depth + 1) }),
    };
  }).filter((g) => g.values!.current !== 0 || g.values!.last_month !== 0)
    .sort((a, b) => Number(b.values!.current) - Number(a.values!.current));
}
const CMP_COLS = [
  { key: "name", label: "Group Name" },
  { key: "current", label: "Current", kind: "money" as const, total: true },
  { key: "last_month", label: "Last Month", kind: "money" as const, total: true },
  { key: "variance", label: "Variance", kind: "money" as const, total: true },
];

// Monthwise Expenses — the same idea as Sales Report's own MonthwisePivotTable
// (a two-row month header isn't expressible in DataTable's generic Col
// system), generalised to N levels of nesting instead of one: a node with
// no children renders flat with no chevron, exactly the shape a single
// selected dimension already needs.
type PivotNode = { key: string; label: string; cells: Record<string, number>; total: number; children?: PivotNode[] };
function buildPivotLevels(rows: MatrixRow[], levels: Level[], depth = 0): PivotNode[] {
  if (depth >= levels.length) return [];
  const byKey = groupByField(rows, levels[depth].field);
  const isLast = depth === levels.length - 1;
  return Array.from(byKey.entries()).map(([key, rs]) => {
    const cells: Record<string, number> = {};
    for (const r of rs) cells[r.month] = (cells[r.month] ?? 0) + r.amount;
    const total = Object.values(cells).reduce((s, v) => s + v, 0);
    return {
      key: `${depth}:${key}`, label: key, cells, total,
      children: isLast ? undefined : buildPivotLevels(rs, levels, depth + 1),
    };
  }).sort((a, b) => b.total - a.total);
}
function PivotRows({ list, depth, expanded, onToggle, monthKeys }: {
  list: PivotNode[]; depth: number; expanded: Set<string>; onToggle: (k: string) => void; monthKeys: string[];
}) {
  return (
    <>
      {list.map((n, i) => {
        const hasChildren = !!(n.children && n.children.length);
        const open = hasChildren && expanded.has(n.key);
        const zebra = i % 2 === 1 ? "bg-slate-100/80" : "";
        return (
          <Fragment key={n.key}>
            <tr className={`${hasChildren ? "cursor-pointer font-semibold" : ""} ${zebra}`} onClick={hasChildren ? () => onToggle(n.key) : undefined}>
              <td className="border border-slate-200 px-3 py-1.5" style={{ paddingLeft: 12 + depth * 18 }}>
                {hasChildren && <span className="mr-1.5 inline-block w-3 text-slate-400">{open ? "▾" : "▸"}</span>}
                {n.label}
              </td>
              {monthKeys.map((mk) => (
                <td key={mk} className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{n.cells[mk] ? money(n.cells[mk]) : "—"}</td>
              ))}
              <td className="border border-slate-200 px-2 py-1.5 text-right font-medium tabular-nums">{money(n.total)}</td>
            </tr>
            {open && n.children && <PivotRows list={n.children} depth={depth + 1} expanded={expanded} onToggle={onToggle} monthKeys={monthKeys} />}
          </Fragment>
        );
      })}
    </>
  );
}
function ExpenseMonthwisePivot({ nodes, monthKeys }: { nodes: PivotNode[]; monthKeys: string[] }) {
  // Depth-0 starts expanded only when there's exactly one Filteration level
  // active (nodes have no children) — that's the case that needs it, since
  // there's nothing else to reveal a level's own numbers. The moment a
  // second level is switched on, depth-0's own row already carries its
  // total, and opening it would immediately dump the whole next level's
  // group rows onto the screen unclicked; expanded starts empty instead, so
  // each level is opened deliberately. The caller remounts this component on
  // filterKey, so a fresh selection re-seeds this from the new top-level
  // nodes rather than carrying over a stale expand set shaped for the old
  // selection.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const hasNesting = nodes.some((n) => n.children && n.children.length > 0);
    return hasNesting ? new Set<string>() : new Set(nodes.map((n) => n.key));
  });
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
          {nodes.length > 0
            ? <PivotRows list={nodes} depth={0} expanded={expanded} onToggle={toggle} monthKeys={monthKeys} />
            : <tr><td colSpan={colCount} className="px-3 py-6 text-center text-slate-400">No expenses in this period.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// Budget and Expense Report — the one grid this screen was missing
// entirely: Budget / Expense / Variance side by side for every selected
// month, at whatever level the same Filteration selection resolves to.
// Budget is a flat, recurring figure (the same every month, matching
// acct_expense_budgets_cc's own shape) computed per node by summing
// exactly the (account, cost centre) PAIRS actually present in that
// node's own rows — so a node driven only by Account (no cost-centre
// level active) sums that account's budget across every cost centre, a
// node driven only by Cost Center sums across every account, and a node
// at both levels reads the one exact cell — always the same population
// the node's own Expense figure was summed over, never a mismatched scope.
type BEOCell = { budget: number; expense: number; variance: number };
type BEONode = { key: string; label: string; monthly: Record<string, BEOCell>; totals: BEOCell; children?: BEONode[] };
function budgetForRows(rs: MatrixRow[], budgetCell: Map<string, number>): number {
  const pairs = new Set<string>();
  for (const r of rs) if (r.cost_center_id) pairs.add(`${r.account_id}::${r.cost_center_id}`);
  let sum = 0;
  for (const p of Array.from(pairs)) sum += budgetCell.get(p) ?? 0;
  return sum;
}
function buildBudgetExpenseLevels(rows: MatrixRow[], levels: Level[], monthKeys: string[], budgetCell: Map<string, number>, depth = 0): BEONode[] {
  if (depth >= levels.length) return [];
  const byKey = groupByField(rows, levels[depth].field);
  const isLast = depth === levels.length - 1;
  return Array.from(byKey.entries()).map(([key, rs]) => {
    const monthlyBudget = budgetForRows(rs, budgetCell);
    const monthly: Record<string, BEOCell> = {};
    let totalExpense = 0;
    for (const mk of monthKeys) {
      const expense = rs.filter((r) => r.month === mk).reduce((s, r) => s + r.amount, 0);
      monthly[mk] = { budget: monthlyBudget, expense, variance: monthlyBudget - expense };
      totalExpense += expense;
    }
    const totalBudget = monthlyBudget * monthKeys.length;
    return {
      key: `${depth}:${key}`, label: key, monthly,
      totals: { budget: totalBudget, expense: totalExpense, variance: totalBudget - totalExpense },
      children: isLast ? undefined : buildBudgetExpenseLevels(rs, levels, monthKeys, budgetCell, depth + 1),
    };
  }).sort((a, b) => b.totals.expense - a.totals.expense);
}
// A negative Variance (over budget) is a solid red cell, not just red text —
// the old software's own screenshot shows it that way, and it is a heavier
// signal than the ERP's usual red-text convention on purpose: this is the
// one figure on the whole page the owner reads as "did we overspend."
const varClass = (n: number) => n < 0 ? "bg-red-600 text-white font-semibold" : "";
function BEORows({ list, depth, expanded, onToggle, monthKeys }: {
  list: BEONode[]; depth: number; expanded: Set<string>; onToggle: (k: string) => void; monthKeys: string[];
}) {
  return (
    <>
      {list.map((n, i) => {
        const hasChildren = !!(n.children && n.children.length);
        const open = hasChildren && expanded.has(n.key);
        const zebra = i % 2 === 1 ? "bg-slate-100/80" : "";
        return (
          <Fragment key={n.key}>
            <tr className={`${hasChildren ? "cursor-pointer font-semibold" : ""} ${zebra}`} onClick={hasChildren ? () => onToggle(n.key) : undefined}>
              <td className="border border-slate-200 px-3 py-1.5" style={{ paddingLeft: 12 + depth * 18 }}>
                {hasChildren && <span className="mr-1.5 inline-block w-3 text-slate-400">{open ? "▾" : "▸"}</span>}
                {n.label}
              </td>
              {monthKeys.map((mk) => {
                const c = n.monthly[mk];
                return (
                  <Fragment key={mk}>
                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{money(c.budget)}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{money(c.expense)}</td>
                    <td className={`border border-slate-200 px-2 py-1.5 text-right tabular-nums ${varClass(c.variance)}`}>{money(c.variance)}</td>
                  </Fragment>
                );
              })}
              <td className="border border-slate-200 px-2 py-1.5 text-right font-medium tabular-nums">{money(n.totals.budget)}</td>
              <td className="border border-slate-200 px-2 py-1.5 text-right font-medium tabular-nums">{money(n.totals.expense)}</td>
              <td className={`border border-slate-200 px-2 py-1.5 text-right font-medium tabular-nums ${varClass(n.totals.variance)}`}>{money(n.totals.variance)}</td>
            </tr>
            {open && n.children && <BEORows list={n.children} depth={depth + 1} expanded={expanded} onToggle={onToggle} monthKeys={monthKeys} />}
          </Fragment>
        );
      })}
    </>
  );
}
function BudgetExpenseReport({ nodes, monthKeys }: { nodes: BEONode[]; monthKeys: string[] }) {
  // Same "depth-0 expands only when there's nothing nested beneath it" rule
  // as ExpenseMonthwisePivot above.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const hasNesting = nodes.some((n) => n.children && n.children.length > 0);
    return hasNesting ? new Set<string>() : new Set(nodes.map((n) => n.key));
  });
  function toggle(k: string) { setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; }); }
  const colCount = monthKeys.length * 3 + 4;
  const grand = nodes.reduce((a, n) => ({
    budget: a.budget + n.totals.budget, expense: a.expense + n.totals.expense, variance: a.variance + n.totals.variance,
  }), { budget: 0, expense: 0, variance: 0 });
  const grandMonthly = monthKeys.map((mk) => nodes.reduce((a, n) => ({
    budget: a.budget + (n.monthly[mk]?.budget ?? 0), expense: a.expense + (n.monthly[mk]?.expense ?? 0), variance: a.variance + (n.monthly[mk]?.variance ?? 0),
  }), { budget: 0, expense: 0, variance: 0 }));

  return (
    <div className="card overflow-x-auto p-0 text-sm">
      <table className="report-grid w-full">
        <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
          <tr>
            <th className="px-3 py-2 text-left" rowSpan={2}><span className="col-resize">Name</span></th>
            {monthKeys.map((mk) => <th key={mk} className="px-2 py-2 text-center" colSpan={3}><span className="col-resize">{monthShort(mk)}</span></th>)}
            <th className="px-2 py-2 text-center" colSpan={3}><span className="col-resize">Total</span></th>
          </tr>
          <tr>
            {monthKeys.map((mk) => (
              <Fragment key={mk}>
                <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Budget</span></th>
                <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Expense</span></th>
                <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Variance</span></th>
              </Fragment>
            ))}
            <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Budget</span></th>
            <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Expense</span></th>
            <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Variance</span></th>
          </tr>
        </thead>
        <tbody>
          {nodes.length > 0
            ? <BEORows list={nodes} depth={0} expanded={expanded} onToggle={toggle} monthKeys={monthKeys} />
            : <tr><td colSpan={colCount} className="px-3 py-6 text-center text-slate-400">No expenses in this period.</td></tr>}
        </tbody>
        {nodes.length > 0 && (
          <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
            <td className="border border-slate-200 px-3 py-1.5">Total</td>
            {grandMonthly.map((g, i) => (
              <Fragment key={monthKeys[i]}>
                <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{money(g.budget)}</td>
                <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{money(g.expense)}</td>
                <td className={`border border-slate-200 px-2 py-1.5 text-right tabular-nums ${varClass(g.variance)}`}>{money(g.variance)}</td>
              </Fragment>
            ))}
            <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{money(grand.budget)}</td>
            <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{money(grand.expense)}</td>
            <td className={`border border-slate-200 px-2 py-1.5 text-right tabular-nums ${varClass(grand.variance)}`}>{money(grand.variance)}</td>
          </tr></tfoot>
        )}
      </table>
    </div>
  );
}

// Expense Report — the old software's "Expenses Detail" dashboard, rebuilt
// on this ERP's own report system (dark-green section headers, DataTable's
// group/values shape, PeriodDropdown) rather than copied pixel-for-pixel.
export default function ExpenseReportView() {
  const sb = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);
  const [expModeOrder, setExpModeOrder] = useState<ExpMode[]>(["acctName"]);

  const [monthly, setMonthly] = useState<{ month: string; amount: number }[]>([]);
  const [lastMonthTotal, setLastMonthTotal] = useState(0);
  const [curMonthTotal, setCurMonthTotal] = useState(0);
  const [ytdTotal, setYtdTotal] = useState(0);

  const [matrixPeriod, setMatrixPeriod] = useState<MatrixRow[]>([]);
  const [matrixLast, setMatrixLast] = useState<MatrixRow[]>([]);
  const [matrixCur, setMatrixCur] = useState<MatrixRow[]>([]);

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
      sb.rpc("report_expense_matrix", { p_from: from, p_to: to }),
      sb.rpc("report_expense_matrix", { p_from: lmFrom, p_to: lmTo }),
      sb.rpc("report_expense_matrix", { p_from: cmFrom, p_to: today }),
      sb.rpc("report_expense_budget_cc", { p_year: ym.year }),
    ]).then(([main, lm, cm, ytd, matP, matL, matC, budget]) => {
      if (!live) return;
      setMonthly(((main.data as any)?.monthly as any[]) ?? []);
      setLastMonthTotal(Number((lm.data as any)?.total ?? 0));
      setCurMonthTotal(Number((cm.data as any)?.total ?? 0));
      setYtdTotal(Number((ytd.data as any)?.total ?? 0));
      setMatrixPeriod((matP.data as any[]) ?? []);
      setMatrixLast((matL.data as any[]) ?? []);
      setMatrixCur((matC.data as any[]) ?? []);
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

  // Nesting order follows CLICK order, not a fixed hierarchy: whichever
  // level the user selected first is outermost. Clicking Account Name then
  // Cost Center nests Cost Center under each Account Name; the same two
  // clicked the other way round nests Account Name under Cost Center.
  const activeLevels = expModeOrder.map((k) => LEVEL_BY_KEY.get(k)!);

  const selectedMonths = Array.from(new Set(ym.months)).sort((a, b) => a - b);
  const monthKeys = selectedMonths.map((m) => `${ym.year}-${pad(m)}`);
  const monthKeySet = new Set(monthKeys);
  // Bounded to exactly the months actually ticked in PeriodDropdown, not
  // the whole [from,to] span — a non-contiguous pick (Jan + Mar) would
  // otherwise silently fold February's figure in too, since the RPCs only
  // take one range.
  const matrixSelected = useMemo(() => matrixPeriod.filter((r) => monthKeySet.has(r.month)), [matrixPeriod, monthKeys.join(",")]);

  const budgetCell = useMemo(() => new Map(budgetRows.map((r) => [`${r.account_id}::${r.cost_center_id}`, Number(r.monthly_amount || 0)])), [budgetRows]);
  const totalMonthlyBudget = budgetRows.reduce((s, r) => s + Number(r.monthly_amount || 0), 0);

  // Every panel below reads the SAME matrixSelected rows the KPI totals are
  // summed from, so "Expense" up top and every grid underneath always
  // reconcile to the same number — no second, independently-derived total
  // to drift out of step with what's actually shown.
  const expenseForPeriod = matrixSelected.reduce((s, r) => s + r.amount, 0);
  const budgetForPeriod = totalMonthlyBudget * selectedMonths.length;
  const varianceForPeriod = budgetForPeriod - expenseForPeriod;
  const usedPct = budgetForPeriod > 0 ? (expenseForPeriod / budgetForPeriod) * 100 : null;

  // Cost Center Wise Expenses — a fixed panel, always CC Group -> Cost
  // Centre, regardless of the Filteration selection (the same "always
  // there" shape P&L's own Cost Center Profit & Loss panel keeps beside
  // its filterable Summary panel) — now with the same expand/collapse a
  // group in this ERP always gets, so a cost centre group's own leaves are
  // one click away instead of only ever shown as one rolled-up figure.
  const ccWiseGroups = useMemo(
    () => buildExpenseLevels(matrixSelected, [ALL_LEVELS[0], ALL_LEVELS[1]]),
    [matrixSelected]
  );

  // Monthly Expense Graph — a month reads red when it ran ABOVE that
  // month's own budget (the flat recurring monthly figure, so effectively
  // a straight reference line), not by sign — an expense total is never
  // negative in the ordinary case — and not by average either: the old
  // software's own screenshot colors a month red exactly when its bar
  // clears its own Budget line, confirmed by checking Mar/Jun/Jul (all
  // above the flat budget line shown) against Jan/Feb/Apr/May/Aug (all at
  // or below it) before writing the rule this way.
  const monthlyChart = monthly.map((m) => ({ ...m, month_label: monthShort(m.month), amount: Number(m.amount || 0), budget: totalMonthlyBudget }));

  const comparisonGroups = buildComparisonLevels(matrixCur, matrixLast, activeLevels);
  const pivotNodes = buildPivotLevels(matrixSelected, activeLevels);
  const budgetExpenseNodes = buildBudgetExpenseLevels(matrixSelected, activeLevels, monthKeys, budgetCell);

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

  // Order matters here, not just membership: Cost Center->Account Name and
  // Account Name->Cost Center are two different trees, so the remount key
  // has to be the click-order array itself, never a sorted/set version of it.
  const filterKey = expModeOrder.join(",");

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
        <p className="mt-1 text-xs text-slate-400">
          Expense — {periodTxt} is the same figure the Budget and Expense Report grid below totals to — check it there.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <SectionHeader title="Cost Center Wise Expenses" />
          <DataTable bare cols={[
            { key: "name", label: "Group Name" },
            { key: "expense", label: "Amount", kind: "money", total: true },
          ]} groups={ccWiseGroups} empty="No expenses in this period." />
        </div>
        <div className="card">
          <SectionHeader title="Monthly Expense Graph" />
          <TrendChart data={monthlyChart} xKey="month_label" series={[
            { key: "amount", label: "Expense", redWhen: (v) => v > totalMonthlyBudget },
            { key: "budget", label: "Budget", type: "line" },
          ]} />
        </div>
      </div>

      {/* Expenses Filteration — all six levels (CC Group, Cost Center,
          Account Group, Account Name, Tag Area Group, Tag Area) are
          independently toggleable and freely combine in any subset, in
          whichever order they're clicked — the click order becomes the
          nesting order (outermost = clicked first), not a fixed hierarchy. */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Expenses Filteration</span>
        <div className="flex flex-wrap gap-1">
          {EXP_MODES.map((m) => {
            const idx = expModeOrder.indexOf(m.key);
            return (
              <button key={m.key} onClick={() => setExpModeOrder((s) => toggleExpMode(s, m.key))}
                className={`rounded-full px-3 py-1 text-sm ${idx >= 0 ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
                {m.label}{idx >= 0 && expModeOrder.length > 1 ? ` ${idx + 1}` : ""}
              </button>
            );
          })}
        </div>
      </div>

      {/* Every table below is keyed on the active Filteration selection so
          it remounts (and its own expand state resets to collapsed)
          whenever it changes — a group key like "Trading" can be a flat
          leaf under Cost Center alone and a group with subgroups the
          moment Account Name is also switched on, so without a fresh
          remount a key already expanded under the old shape opens
          pre-expanded under the new one. */}
      <div>
        <SectionHeader title="Last vs Current Month Comparison" />
        <DataTable key={filterKey} cols={CMP_COLS} groups={comparisonGroups} startCollapsed={activeLevels.length > 1} empty="No expenses to compare." />
      </div>

      {monthKeys.length > 1 && (
        <div>
          <SectionHeader title="Monthwise Expenses" />
          <ExpenseMonthwisePivot key={filterKey} nodes={pivotNodes} monthKeys={monthKeys} />
        </div>
      )}

      <div>
        <SectionHeader title="Budget and Expense Report" />
        <BudgetExpenseReport key={filterKey} nodes={budgetExpenseNodes} monthKeys={monthKeys} />
      </div>

      <div>
        <SectionHeader title={`Monthly and Yearly Budgets — ${ym.year}`} />
        <div className="card overflow-x-auto p-0 text-sm">
          <table className="report-grid w-full">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr>
                <th className="border border-slate-200 px-3 py-2.5 text-left" rowSpan={2}><span className="col-resize">Account</span></th>
                {budgetCostCentres.map((cc) => (
                  <th key={cc.id} className="border border-l-2 border-slate-300 px-2 py-2.5 text-center" colSpan={2}><span className="col-resize-wrap">{cc.name}</span></th>
                ))}
                <th className="border border-l-2 border-slate-300 px-2 py-2.5 text-center" colSpan={2}><span className="col-resize">Total</span></th>
              </tr>
              <tr>
                {budgetCostCentres.map((cc) => (
                  <Fragment key={cc.id}>
                    <th className="border border-l-2 border-slate-300 px-2 py-1.5 text-right font-normal"><span className="col-resize">Monthly</span></th>
                    <th className="border border-slate-200 px-2 py-1.5 text-right font-normal"><span className="col-resize">Yearly</span></th>
                  </Fragment>
                ))}
                <th className="border border-l-2 border-slate-300 px-2 py-1.5 text-right font-normal"><span className="col-resize">Monthly</span></th>
                <th className="border border-slate-200 px-2 py-1.5 text-right font-normal"><span className="col-resize">Yearly</span></th>
              </tr>
            </thead>
            <tbody>
              {budgetAccounts.map((acc, i) => {
                const rowTotal = budgetCostCentres.reduce((s, cc) => s + (budgetCell.get(`${acc.id}::${cc.id}`) ?? 0), 0);
                return (
                  <tr key={acc.id} className={i % 2 === 1 ? "bg-slate-100/80" : ""}>
                    <td className="border border-slate-200 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-slate-400">{acc.group}</div>
                      <div>{acc.name}</div>
                    </td>
                    {budgetCostCentres.map((cc) => {
                      const key = `${acc.id}::${cc.id}`;
                      const val = budgetCell.get(key) ?? 0;
                      return (
                        <Fragment key={cc.id}>
                          <td className="border border-l-2 border-slate-300 px-1.5 py-1.5 text-right">
                            <input className="input w-24 text-right tabular-nums" inputMode="decimal"
                              value={budgetDraft[key] ?? String(val)}
                              onChange={(e) => setBudgetDraft((d) => ({ ...d, [key]: e.target.value }))}
                              onBlur={() => saveBudgetCell(acc.id, cc.id)} />
                          </td>
                          <td className="border border-slate-200 px-2 py-2 text-right tabular-nums text-slate-500">{money(val * 12)}</td>
                        </Fragment>
                      );
                    })}
                    <td className="border border-l-2 border-slate-300 px-2 py-2 text-right font-medium tabular-nums">{money(rowTotal)}</td>
                    <td className="border border-slate-200 px-2 py-2 text-right font-medium tabular-nums">{money(rowTotal * 12)}</td>
                  </tr>
                );
              })}
              {budgetAccounts.length === 0 && (
                <tr><td colSpan={budgetCostCentres.length * 2 + 3} className="px-3 py-6 text-center text-slate-400">No expense accounts or cost centres.</td></tr>
              )}
            </tbody>
            {budgetAccounts.length > 0 && (
              <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td className="border border-slate-200 px-3 py-2">Total</td>
                {budgetCostCentres.map((cc) => {
                  const colTotal = budgetAccounts.reduce((s, acc) => s + (budgetCell.get(`${acc.id}::${cc.id}`) ?? 0), 0);
                  return (
                    <Fragment key={cc.id}>
                      <td className="border border-l-2 border-slate-300 px-2 py-2 text-right tabular-nums">{money(colTotal)}</td>
                      <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{money(colTotal * 12)}</td>
                    </Fragment>
                  );
                })}
                <td className="border border-l-2 border-slate-300 px-2 py-2 text-right tabular-nums">{money(totalMonthlyBudget)}</td>
                <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{money(totalMonthlyBudget * 12)}</td>
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
