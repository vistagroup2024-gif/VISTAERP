"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, monthShort } from "@/lib/format";
import { todaySA, monthStartSA } from "@/lib/saudiTime";
import { defaultYearMonths, monthRanges, periodLabel, type YearMonths } from "@/lib/reports/period";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import TrendChart from "@/components/reports/charts/TrendChart";
import DonutChart from "@/components/reports/charts/DonutChart";
import DataTable, { type DataGroup } from "@/components/reports/DataTable";
import ReportKpi from "@/components/reports/ReportKpi";
import SectionHeader from "@/components/reports/SectionHeader";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const qtyFmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);

const EMPTY = {
  total: 0, txns: 0, monthly: [] as any[], by_cost_centre: [] as any[], by_cc_month: [] as any[],
  by_cc_month_target: [] as any[],
  by_customer: [] as any[], by_customer_month: [] as any[], by_product: [] as any[], by_product_month: [] as any[],
};
type SalesData = typeof EMPTY;

// Every breakdown on this report — the LY vs CY comparison and the
// Monthwise pivot — is a view of the same sales data sliced by one or more
// of these four dimensions. A sales LINE genuinely carries all four at
// once (a document's cost centre and customer, a line's product), so "this
// customer's sales by product" is a real, answerable question — not four
// independent parallel slices the way this report first built it. "View
// By" is one shared multi-select governing both sections, and the click
// ORDER is the nesting order: whichever is clicked first is outermost, the
// same rule Expense Report (441/442) and P&L (443) already use.
type Dim = "ccGroup" | "costCentre" | "customer" | "product";
const DIM_ORDER: Dim[] = ["ccGroup", "costCentre", "customer", "product"];
const DIM_LABEL: Record<Dim, string> = { ccGroup: "CC Group", costCentre: "Cost Centre", customer: "Customer", product: "Product" };
// Only Cost Centre Group and Cost Centre carry a target (acct_cost_center_monthly_targets
// is keyed on a cost centre) — a customer or a product has no target concept
// in this schema, so Sales vs Target only ever renders for these two, and
// stays on its own fixed Group->leaf shape (structurally one hierarchy, the
// same reason P&L's CC Group/Cost Center order was never ambiguous either)
// rather than joining the click-order matrix system below.
const TARGET_DIMS: Dim[] = ["ccGroup", "costCentre"];

// report_sales_matrix() (444) — one row per (cost centre, customer,
// product, month), carrying every dimension's id/name/group at once, the
// Sales Report twin of report_expense_matrix()/report_pl_matrix(). CC
// Group, Cost Centre, Customer and Product are four freely-combinable,
// freely-orderable levels of the SAME rows now.
type MatrixRow = {
  cost_center_id: string | null; cost_center: string; cost_center_group: string;
  customer: string; customer_account_id: string | null;
  product: string; month: string; amount: number; qty: number;
};
type DimLevel = { key: Dim; label: string; field: (r: MatrixRow) => string };
const DIM_LEVELS: DimLevel[] = [
  { key: "ccGroup", label: "CC Group", field: (r) => r.cost_center_group },
  { key: "costCentre", label: "Cost Centre", field: (r) => r.cost_center },
  { key: "customer", label: "Customer", field: (r) => r.customer },
  { key: "product", label: "Product", field: (r) => r.product },
];
const DIM_LEVEL_BY_KEY = new Map(DIM_LEVELS.map((l) => [l.key, l]));

function groupByDimField(rows: MatrixRow[], field: (r: MatrixRow) => string): Map<string, MatrixRow[]> {
  const m = new Map<string, MatrixRow[]>();
  for (const r of rows) { const k = field(r); const arr = m.get(k) ?? []; arr.push(r); m.set(k, arr); }
  return m;
}

// LY vs CY, nested in click order — groups the current- and previous-year
// matrix SIMULTANEOUSLY by the same key at each level, the same shape
// Expense Report's buildComparisonLevels uses, except growth here follows
// Sales Report's own established direction (cy - ly, positive = grew =
// good), never Expense's reversed "less is better" one.
function buildSalesComparisonLevels(curRows: MatrixRow[], lastRows: MatrixRow[], levels: DimLevel[], depth = 0): DataGroup[] {
  if (depth >= levels.length) return [];
  const field = levels[depth].field;
  const curByKey = groupByDimField(curRows, field);
  const lastByKey = groupByDimField(lastRows, field);
  const keys = new Set([...Array.from(curByKey.keys()), ...Array.from(lastByKey.keys())]);
  const isLast = depth === levels.length - 1;
  return Array.from(keys).map((key) => {
    const curRs = curByKey.get(key) ?? [], lastRs = lastByKey.get(key) ?? [];
    const cy = curRs.reduce((s, r) => s + r.amount, 0), ly = lastRs.reduce((s, r) => s + r.amount, 0);
    return {
      key: `${depth}:${key}`, label: key, rows: [] as any[],
      values: { ly, cy, growth: ly ? ((cy - ly) / Math.abs(ly)) * 100 : null },
      ...(isLast ? {} : { subgroups: buildSalesComparisonLevels(curRs, lastRs, levels, depth + 1) }),
    };
  }).filter((g) => g.values!.cy !== 0 || g.values!.ly !== 0)
    .sort((a, b) => Number(b.values!.cy) - Number(a.values!.cy));
}

// Name x month -> {amount, qty} at every depth of the nested pivot — Value/
// Qty are both carried per cell so the toggle just picks which to display.
type MonthCell = { amount: number; qty: number };
type PivotNode = { key: string; label: string; cells: Record<string, MonthCell>; total: MonthCell; children?: PivotNode[] };
function buildSalesPivotLevels(rows: MatrixRow[], levels: DimLevel[], depth = 0): PivotNode[] {
  if (depth >= levels.length) return [];
  const byKey = groupByDimField(rows, levels[depth].field);
  const isLast = depth === levels.length - 1;
  return Array.from(byKey.entries()).map(([key, rs]) => {
    const cells: Record<string, MonthCell> = {};
    for (const r of rs) {
      const c = cells[r.month] ?? { amount: 0, qty: 0 };
      c.amount += r.amount; c.qty += r.qty;
      cells[r.month] = c;
    }
    const total = Object.values(cells).reduce((a, c) => ({ amount: a.amount + c.amount, qty: a.qty + c.qty }), { amount: 0, qty: 0 });
    return {
      key: `${depth}:${key}`, label: key, cells, total,
      children: isLast ? undefined : buildSalesPivotLevels(rs, levels, depth + 1),
    };
  }).sort((a, b) => b.total.amount - a.total.amount);
}

// Selecting non-contiguous months (Jan + Mar, say) can't be expressed as one
// p_from/p_to range, so monthRanges() splits it into the fewest contiguous
// ranges and report_sales() is called once per range — usually just once,
// since "all months" and any single run of months are already one range —
// and the results are summed/merged here. Same RPC, same figures; this is
// arithmetic on its already-verified output, not a second calculation.
function mergeSales(parts: SalesData[]): SalesData {
  if (parts.length === 0) return EMPTY;
  if (parts.length === 1) return parts[0];
  const mergeByKey = (arrs: any[][], keyFn: (r: any) => string, sumKeys: string[]) => {
    const map = new Map<string, any>();
    for (const arr of arrs) for (const r of arr ?? []) {
      const k = keyFn(r);
      const existing = map.get(k) ?? { ...r };
      if (map.has(k)) for (const sk of sumKeys) existing[sk] = Number(existing[sk] || 0) + Number(r[sk] || 0);
      map.set(k, existing);
    }
    return Array.from(map.values());
  };
  return {
    total: parts.reduce((s, p) => s + Number(p.total || 0), 0),
    txns: parts.reduce((s, p) => s + Number(p.txns || 0), 0),
    monthly: parts.flatMap((p) => p.monthly ?? []),
    by_cc_month: parts.flatMap((p) => p.by_cc_month ?? []),
    by_cc_month_target: parts.flatMap((p) => p.by_cc_month_target ?? []),
    by_customer_month: parts.flatMap((p) => p.by_customer_month ?? []),
    by_product_month: parts.flatMap((p) => p.by_product_month ?? []),
    by_cost_centre: mergeByKey(parts.map((p) => p.by_cost_centre), (r) => r.name, ["amount", "txns", "qty"]),
    by_customer: mergeByKey(parts.map((p) => p.by_customer), (r) => r.account_id ?? r.name, ["amount", "txns", "qty"]),
    by_product: mergeByKey(parts.map((p) => p.by_product), (r) => r.name, ["amount", "qty"]),
  };
}

async function fetchSales(sb: ReturnType<typeof createClient>, ym: YearMonths): Promise<SalesData> {
  const ranges = monthRanges(ym);
  if (ranges.length === 0) return EMPTY;
  const results = await Promise.all(ranges.map((r) =>
    sb.rpc("report_sales", { p_company: COMPANY_ID, p_from: r.from, p_to: r.to }).then(({ data }) => (data as SalesData) ?? EMPTY)));
  return mergeSales(results);
}

const PIVOT_COLS = (monthKeys: string[], showValue: boolean, showQty: boolean) => monthKeys.length * ((showValue ? 1 : 0) + (showQty ? 1 : 0)) + 1 + (showValue ? 1 : 0) + (showQty ? 1 : 0);

// The Monthwise Sales pivot — ONE tree, nested in whatever order "View By"
// was clicked in (Customer then Product nests each customer's own products
// under it; the reverse click order nests the other way). Hand-rolled
// rather than DataTable's own grouped mode, because the two-row month/
// Value-Qty header this pivot needs isn't something DataTable's generic Col
// system expresses — but the group open/closed affordance follows the same
// depth-0-starts-expanded rule DataTable itself now does.
function PivotRows({ list, depth, expanded, onToggle, monthKeys, showValue, showQty }: {
  list: PivotNode[]; depth: number; expanded: Set<string>; onToggle: (k: string) => void; monthKeys: string[]; showValue: boolean; showQty: boolean;
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
              <td className="px-3 py-1.5" style={{ paddingLeft: 12 + depth * 18 }}>
                {hasChildren && <span className="mr-1.5 inline-block w-3 text-slate-400">{open ? "▾" : "▸"}</span>}
                {n.label}
              </td>
              {monthKeys.map((mk) => (
                <Fragment key={mk}>
                  {showValue && <td className="px-2 py-1.5 text-right tabular-nums">{n.cells[mk]?.amount ? money(n.cells[mk].amount) : "—"}</td>}
                  {showQty && <td className="px-2 py-1.5 text-right tabular-nums">{n.cells[mk]?.qty ? qtyFmt(n.cells[mk].qty) : "—"}</td>}
                </Fragment>
              ))}
              {showValue && <td className="px-2 py-1.5 text-right font-medium tabular-nums">{money(n.total.amount)}</td>}
              {showQty && <td className="px-2 py-1.5 text-right font-medium tabular-nums">{qtyFmt(n.total.qty)}</td>}
            </tr>
            {open && n.children && <PivotRows list={n.children} depth={depth + 1} expanded={expanded} onToggle={onToggle} monthKeys={monthKeys} showValue={showValue} showQty={showQty} />}
          </Fragment>
        );
      })}
    </>
  );
}
function MonthwisePivotTable({ nodes, monthKeys, showValue, showQty }: {
  nodes: PivotNode[]; monthKeys: string[]; showValue: boolean; showQty: boolean;
}) {
  // Depth-0 (the outermost, first-clicked "View By" dimension) starts
  // expanded only when nothing is nested beneath it (a single dimension
  // selected) — its own row already carries real Value/Qty totals, so once a
  // SECOND dimension is added, opening depth-0 would immediately dump that
  // whole next level's group rows onto the screen unclicked. expanded then
  // starts empty and each level is opened deliberately. The caller remounts
  // this component on the click-order dimension key, so a fresh selection or
  // a reordering re-seeds this from the new top-level nodes.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const hasNesting = nodes.some((n) => n.children && n.children.length > 0);
    return hasNesting ? new Set<string>() : new Set(nodes.map((n) => n.key));
  });
  function toggle(k: string) { setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; }); }
  const colCount = PIVOT_COLS(monthKeys, showValue, showQty);

  return (
    <div className="card overflow-x-auto p-0 text-sm">
      <table className="report-grid w-full">
        <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
          <tr>
            <th className="px-3 py-2 text-left" rowSpan={2}><span className="col-resize">Name</span></th>
            {monthKeys.map((mk) => <th key={mk} className="px-3 py-2 text-center" colSpan={(showValue ? 1 : 0) + (showQty ? 1 : 0)}><span className="col-resize">{monthShort(mk)}</span></th>)}
            <th className="px-3 py-2 text-center" colSpan={(showValue ? 1 : 0) + (showQty ? 1 : 0)}><span className="col-resize">Total</span></th>
          </tr>
          <tr>
            {monthKeys.map((mk) => (
              <Fragment key={mk}>
                {showValue && <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Value</span></th>}
                {showQty && <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Qty</span></th>}
              </Fragment>
            ))}
            {showValue && <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Value</span></th>}
            {showQty && <th className="px-2 py-1 text-right font-normal"><span className="col-resize">Qty</span></th>}
          </tr>
        </thead>
        <tbody>
          {nodes.length > 0
            ? <PivotRows list={nodes} depth={0} expanded={expanded} onToggle={toggle} monthKeys={monthKeys} showValue={showValue} showQty={showQty} />
            : <tr><td colSpan={colCount} className="px-3 py-6 text-center text-slate-400">Select a dimension in View By above.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// Sales Report — the dashboard's Sales card detail screen. report_sales()
// (409, extended 421/423/431) is the one "every sale the business made"
// definition dashboard_metrics() already established; report_cost_center_targets()
// (already live, used by Targets & Budget) supplies Target vs Actual.
// Year + Months replaces the old From/To form — defaults to the current
// year with every month ticked and loads immediately, same RPCs, no Run
// button. Non-contiguous month picks call report_sales once per contiguous
// run and merge client-side (see mergeSales above); every other case is one
// call, exactly as before.
export default function SalesReportView() {
  const sb = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths());
  const [s, setS] = useState<SalesData>(EMPTY);
  const [py, setPy] = useState<SalesData>(EMPTY);
  const [curMonth, setCurMonth] = useState<SalesData>(EMPTY);
  const [prevMonth, setPrevMonth] = useState<SalesData>(EMPTY);
  const [targets, setTargets] = useState<any[]>([]);
  const [curMonthTargets, setCurMonthTargets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Click order = nesting order — whichever dimension is clicked first is
  // outermost. Appending on click-on and filtering out on click-off keeps
  // the relative order of what's left, the same rule Expense Report and
  // P&L use for their own Filteration.
  const [dimOrder, setDimOrder] = useState<Dim[]>(["ccGroup"]);
  const [matrixRaw, setMatrixRaw] = useState<MatrixRow[]>([]);
  const [matrixPyRaw, setMatrixPyRaw] = useState<MatrixRow[]>([]);
  // Both can be on at once — "if we want to see qty + value so both should
  // come" — at least one stays on so the grid is never empty.
  const [showValue, setShowValue] = useState(true);
  const [showQty, setShowQty] = useState(false);

  function toggleDim(d: Dim) {
    setDimOrder((prev) => {
      if (prev.includes(d)) return prev.length > 1 ? prev.filter((k) => k !== d) : prev;
      return [...prev, d];
    });
  }

  useEffect(() => {
    let live = true;
    setLoading(true);
    const ranges = monthRanges(ym);
    const from = ranges[0]?.from ?? `${ym.year}-01-01`;
    const to = ranges[ranges.length - 1]?.to ?? `${ym.year}-12-31`;
    const pad = (n: number) => String(n).padStart(2, "0");
    const lastMonthDate = () => {
      const t = todaySA(); const y = Number(t.slice(0, 4)); const m = Number(t.slice(5, 7));
      const py2 = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
      const last = new Date(Date.UTC(py2, pm, 0)).getUTCDate();
      return [`${py2}-${pad(pm)}-01`, `${py2}-${pad(pm)}-${pad(last)}`] as const;
    };
    const [lmFrom, lmTo] = lastMonthDate();
    // The full current calendar month's own target — deliberately NOT
    // bounded at today, so "Current Month Target" reads the whole month's
    // figure even on day 3, and "Current Month Achievement %" compares
    // month-to-date sales against it honestly (a partial month against a
    // full target) rather than a target prorated to make the % look better.
    const curMonthEnd = () => {
      const t = todaySA(); const y = Number(t.slice(0, 4)); const m = Number(t.slice(5, 7));
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return `${t.slice(0, 7)}-${pad(last)}`;
    };
    const shiftYear = (d: string, delta: number) => {
      const [y, m, dd] = d.split("-").map(Number);
      return `${y + delta}-${pad(m)}-${pad(dd)}`;
    };

    Promise.all([
      fetchSales(sb, ym),
      fetchSales(sb, { year: ym.year - 1, months: ym.months }),
      sb.rpc("report_sales", { p_company: COMPANY_ID, p_from: monthStartSA(), p_to: todaySA() }).then(({ data }) => (data as SalesData) ?? EMPTY),
      sb.rpc("report_sales", { p_company: COMPANY_ID, p_from: lmFrom, p_to: lmTo }).then(({ data }) => (data as SalesData) ?? EMPTY),
      sb.rpc("report_cost_center_targets", { p_from: from, p_to: to }).then(({ data }) => (data as any[]) ?? []),
      sb.rpc("report_cost_center_targets", { p_from: monthStartSA(), p_to: curMonthEnd() }).then(({ data }) => (data as any[]) ?? []),
      sb.rpc("report_sales_matrix", { p_company: COMPANY_ID, p_from: from, p_to: to }).then(({ data }) => (data as MatrixRow[]) ?? []),
      sb.rpc("report_sales_matrix", { p_company: COMPANY_ID, p_from: shiftYear(from, -1), p_to: shiftYear(to, -1) }).then(({ data }) => (data as MatrixRow[]) ?? []),
    ]).then(([sData, pyData, cm, pm, tg, curTg, matD, matPyD]) => {
      if (!live) return;
      setS(sData); setPy(pyData); setCurMonth(cm); setPrevMonth(pm);
      setTargets(tg.filter((r) => Number(r.actual || 0) || Number(r.target || 0)));
      setCurMonthTargets(curTg);
      setMatrixRaw(matD); setMatrixPyRaw(matPyD);
      setLoading(false);
    });
    return () => { live = false; };
  }, [sb, ym.year, ym.months.join(",")]);

  const totalTarget = targets.reduce((a, r) => a + Number(r.target || 0), 0);
  const achievement = totalTarget > 0 ? (Number(s.total) / totalTarget) * 100 : null;
  const avgSale = s.txns > 0 ? Number(s.total) / s.txns : 0;
  const totalQty = s.by_product.reduce((a: number, r: any) => a + Number(r.qty || 0), 0);
  // The Target/Achievement/Difference KPIs below are the sum of whichever
  // months PeriodDropdown has selected (report_cost_center_targets is asked
  // for exactly that [from,to]) — not always the whole year. The period is
  // named right on the label so this never has to be guessed at.
  const periodTxt = periodLabel(ym);
  // Current Month Target / Achievement — always THIS calendar month,
  // regardless of what the PeriodDropdown above is set to, so the owner
  // reads "how is this month doing" at a glance without changing the
  // report's own period selection.
  const curMonthTargetTotal = curMonthTargets.reduce((a, r) => a + Number(r.target || 0), 0);
  const curMonthAchievement = curMonthTargetTotal > 0 ? (Number(curMonth.total) / curMonthTargetTotal) * 100 : null;

  // Target per cost centre, keyed by name, for the nested table below.
  const targetByName = new Map(targets.map((r) => [r.cost_center, Number(r.target || 0)]));

  // Group -> Cost Centre, one nested table replacing the old separate
  // "Target vs Actual by Group" chart+table and "Cost Centre CY vs PY"
  // table — every figure either already had is still here, now in one
  // place you expand into instead of two you have to cross-reference.
  const ccGroupMap = new Map<string, any[]>();
  for (const r of s.by_cost_centre) {
    const arr = ccGroupMap.get(r.cost_center_group) ?? [];
    const pyAmt = py.by_cost_centre.find((x: any) => x.name === r.name)?.amount ?? 0;
    arr.push({
      name: r.name, current_year: Number(r.amount || 0), previous_year: Number(pyAmt),
      difference: Number(r.amount || 0) - Number(pyAmt),
      difference_pct: pyAmt ? ((Number(r.amount || 0) - Number(pyAmt)) / Math.abs(Number(pyAmt))) * 100 : null,
      contribution: Number(s.total) !== 0 ? (Number(r.amount || 0) / Number(s.total)) * 100 : 0,
      target: targetByName.get(r.name) ?? 0,
    });
    ccGroupMap.set(r.cost_center_group, arr);
  }
  const ccGroups: DataGroup[] = Array.from(ccGroupMap.entries()).map(([group, rows]) => {
    const groupTotal = rows.reduce((a, r) => a + r.current_year, 0);
    const groupTarget = rows.reduce((a, r) => a + r.target, 0);
    const groupPY = rows.reduce((a, r) => a + r.previous_year, 0);
    const groupDiff = rows.reduce((a, r) => a + r.difference, 0);
    rows.sort((a, b) => b.current_year - a.current_year);
    // `values` — the same "group row IS a P&L line" pattern P&L uses — puts
    // Target/CY/PY/Difference/Difference%/Contribution right on the group's
    // own header row, formatted and red-on-loss like any other cell. The old
    // `meta` text folded only the target into one caption string and hid
    // everything else until you clicked ▸, which is exactly what read as
    // "blank" group rows.
    return {
      key: group, label: group, rows,
      values: {
        target: groupTarget, current_year: groupTotal, previous_year: groupPY, difference: groupDiff,
        difference_pct: groupPY ? (groupDiff / Math.abs(groupPY)) * 100 : null,
        contribution: Number(s.total) !== 0 ? (groupTotal / Number(s.total)) * 100 : 0,
      },
    };
  }).sort((a, b) => (b.values!.current_year ?? 0) - (a.values!.current_year ?? 0));

  // The months actually selected, as columns — and the bound both matrix
  // fetches (current period and previous year) get filtered down to, since
  // a non-contiguous month pick (Jan + Mar) can't be expressed as the
  // RPC's own single p_from/p_to range.
  const selectedMonths = Array.from(new Set(ym.months)).sort((a, b) => a - b);
  const monthKeys = selectedMonths.map((m) => `${ym.year}-${String(m).padStart(2, "0")}`);
  const monthKeySet = new Set(monthKeys);
  const pyMonthKeys = selectedMonths.map((m) => `${ym.year - 1}-${String(m).padStart(2, "0")}`);
  const pyMonthKeySet = new Set(pyMonthKeys);
  const matrixSelected = useMemo(() => matrixRaw.filter((r) => monthKeySet.has(r.month)), [matrixRaw, monthKeys.join(",")]);
  const matrixPySelected = useMemo(() => matrixPyRaw.filter((r) => pyMonthKeySet.has(r.month)), [matrixPyRaw, pyMonthKeys.join(",")]);

  // Still needed by Sales vs Target of Completed Months below, which stays
  // on its own fixed ccGroup/costCentre-only shape (see TARGET_DIMS) rather
  // than joining the click-order matrix — a customer or product has no
  // target concept in this schema.
  const ccGroupMonthly = useMemo(() => {
    const m = new Map<string, { name: string; month: string; amount: number; qty: number }>();
    for (const r of s.by_cc_month) {
      const key = `${r.cost_center_group}::${r.month}`;
      const existing = m.get(key) ?? { name: r.cost_center_group, month: r.month, amount: 0, qty: 0 };
      existing.amount += Number(r.amount || 0); existing.qty += Number(r.qty || 0);
      m.set(key, existing);
    }
    return Array.from(m.values());
  }, [s.by_cc_month]);
  const costCentreMonthly = s.by_cc_month.map((r: any) => ({ name: r.cost_center, month: r.month, amount: Number(r.amount || 0), qty: Number(r.qty || 0) }));

  // Sales vs Target of Completed Months — the old software's own table,
  // scoped to months that have actually ended (a month "in progress" isn't
  // measured against its target yet). by_cc_month_target (436) carries both
  // the leaf cost_center and its cost_center_group per row, so the same
  // source drives either granularity ccGroup/costCentre selects. A month is
  // "completed" once the NEXT month has started — comparing wall-clock
  // Riyadh "today" against it, never the selected period's own end date.
  // The section title says "Completed Months" once — it doesn't also spell
  // out which months those are; that's what the word already means, and a
  // long comma list of month names was exactly the un-professional clutter
  // this was called out for.
  const isMonthCompleted = (monthKey: string) => {
    const [y, m] = monthKey.split("-").map(Number);
    const nextStart = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    return nextStart <= todaySA();
  };
  const completedMonthKeys = monthKeys.filter(isMonthCompleted);

  function salesVsTargetForDim(dim: Dim) {
    const nameField = dim === "ccGroup" ? "cost_center_group" : "cost_center";
    const salesSource = dim === "ccGroup" ? ccGroupMonthly : costCentreMonthly;
    const targetMap = new Map<string, number>();
    for (const r of s.by_cc_month_target) {
      const key = `${r[nameField]}::${r.month}`;
      targetMap.set(key, (targetMap.get(key) ?? 0) + Number(r.target || 0));
    }
    const salesMap = new Map<string, number>();
    for (const r of salesSource) salesMap.set(`${r.name}::${r.month}`, r.amount);
    const names = Array.from(new Set([...salesSource.map((r) => r.name), ...s.by_cc_month_target.map((r: any) => r[nameField])]));
    return names.map((name) => {
      let sales = 0, target = 0;
      for (const mk of completedMonthKeys) {
        sales += salesMap.get(`${name}::${mk}`) ?? 0;
        target += targetMap.get(`${name}::${mk}`) ?? 0;
      }
      return { name, target, sales, achieved: target > 0 ? (sales / target) * 100 : null };
    }).filter((r) => r.sales !== 0 || r.target !== 0).sort((a, b) => b.sales - a.sales);
  }

  // Cost Centre Group share of total — the same ccGroups rollup the nested
  // table already built, read for its totals rather than recomputed.
  const ccGroupChartData = ccGroups.map((g) => ({ name: g.label, amount: Number(g.values!.current_year) }));

  const monthlyRows = s.monthly.map((m: any) => ({
    month: m.month, month_label: monthShort(m.month), txns: m.txns, amount: m.amount, average: m.txns > 0 ? Number(m.amount) / m.txns : 0,
  })).sort((a: any, b: any) => a.month.localeCompare(b.month));

  const customerRows = s.by_customer.map((r: any) => ({
    ...r, contribution: Number(s.total) !== 0 ? (Number(r.amount) / Number(s.total)) * 100 : 0,
  })).sort((a: any, b: any) => b.amount - a.amount);

  // Click order = nesting order for both matrix-driven sections below.
  // Sales vs Target stays on its own fixed ccGroup/costCentre order (see
  // TARGET_DIMS) since Group->leaf is one structural hierarchy there, the
  // same reason P&L's own CC Group/Cost Center order was never ambiguous.
  const dimLevels = dimOrder.map((d) => DIM_LEVEL_BY_KEY.get(d)!);
  const activeTargetDims = TARGET_DIMS.filter((d) => dimOrder.includes(d));

  // LY vs CY — nested in click order, off the matrix (current vs previous
  // year, both bounded to the exact selected months). Picking Customer then
  // Product nests each customer's own products under it; the same two
  // clicked the other way round nests the other way.
  const lyVsCyGroups: DataGroup[] = buildSalesComparisonLevels(matrixSelected, matrixPySelected, dimLevels);

  const salesVsTargetGroups: DataGroup[] = activeTargetDims.map((d) => {
    const rows = salesVsTargetForDim(d);
    const target = rows.reduce((s, r) => s + r.target, 0);
    const sales = rows.reduce((s, r) => s + r.sales, 0);
    return {
      key: d, label: `${DIM_LABEL[d]} wise Sales vs Target`, rows,
      values: { target, sales, achieved: target > 0 ? (sales / target) * 100 : null },
    };
  });

  const pivotNodes = buildSalesPivotLevels(matrixSelected, dimLevels);
  // Remounts each dimension-driven table when the active combination
  // changes, so a freshly-toggled-on (or reordered) dimension seeds its own
  // "starts expanded" state fresh rather than carrying over whatever an
  // earlier combination had already opened or closed. Click order is part
  // of the key — Customer->Product and Product->Customer are different
  // trees, so this is dimOrder itself, never a sorted version of it.
  const dimsKey = dimOrder.join(",");

  return (
    <div className="space-y-4">
      <PageHeader title="Sales Report">
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Summary — {periodTxt}{loading ? " (loading…)" : ""}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <ReportKpi label="Total Sales (period)" value={money(s.total)} icon="sales" tone="info" />
          <ReportKpi label="Current Month" value={money(curMonth.total)} icon="sales" />
          <ReportKpi label="Current Month Target" value={money(curMonthTargetTotal)} icon="trendUp" />
          <ReportKpi label="Current Month Achievement %" value={curMonthAchievement === null ? "No target set" : `${curMonthAchievement.toFixed(1)}%`} icon="trendUp"
            tone={curMonthAchievement !== null ? (curMonthAchievement >= 100 ? "pos" : curMonthAchievement >= 80 ? "warn" : "neg") : undefined} />
          <ReportKpi label="Previous Month" value={money(prevMonth.total)} icon="sales" />
          <ReportKpi label="Previous Year (same months)" value={money(py.total)} icon="sales" />
          <ReportKpi label={`Target — ${periodTxt}`} value={money(totalTarget)} icon="trendUp" />
          <ReportKpi label={`Achievement % — ${periodTxt}`} value={achievement === null ? "No target set" : `${achievement.toFixed(1)}%`} icon="trendUp"
            tone={achievement !== null ? (achievement >= 100 ? "pos" : achievement >= 80 ? "warn" : "neg") : undefined} />
          <ReportKpi label={`Difference vs Target — ${periodTxt}`} value={money(Number(s.total) - totalTarget)} icon="trendUp" tone={Number(s.total) - totalTarget >= 0 ? "pos" : "neg"} />
          <ReportKpi label="Transactions" value={String(s.txns)} icon="receipt" />
          <ReportKpi label="Quantity" value={qtyFmt(totalQty)} icon="inventory" />
          <ReportKpi label="Average Sale" value={money(avgSale)} icon="sales" />
        </div>
      </div>

      {s.monthly.length > 1 && (
        <div className="card">
          <SectionHeader title="Monthly Trend" />
          <TrendChart data={monthlyRows} xKey="month_label" series={[{ key: "amount", label: "Sales" }]} />
        </div>
      )}

      {ccGroupChartData.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <SectionHeader title="Cost Centre Group Share" />
            <DonutChart data={ccGroupChartData} nameKey="name" valueKey="amount" height={260} />
          </div>
          <div className="card">
            <SectionHeader title="Cost Centre Group wise Sales" />
            <TrendChart data={ccGroupChartData} xKey="name" series={[{ key: "amount", label: "Sales" }]} height={260} />
          </div>
        </div>
      )}

      {/* Shared multi-select — governs LY vs CY and Monthwise Sales below,
          nested in whichever order they're clicked (click first = outermost).
          Sales vs Target reads the same selection but stays its own fixed
          CC Group -> Cost Centre shape, since it has no Customer/Product
          concept to nest with. */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">View By</span>
        <div className="flex flex-wrap gap-1">
          {DIM_ORDER.map((d) => {
            const idx = dimOrder.indexOf(d);
            return (
              <button key={d} onClick={() => toggleDim(d)}
                className={`rounded-full px-3 py-1 text-sm ${idx >= 0 ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
                {DIM_LABEL[d]}{idx >= 0 && dimOrder.length > 1 ? ` ${idx + 1}` : ""}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <SectionHeader title="Sales — LY vs CY" />
        <DataTable key={dimsKey}
          cols={[
            { key: "name", label: "Name" },
            { key: "ly", label: "LY Sales", kind: "money", total: true },
            { key: "cy", label: "CY Sales", kind: "money", total: true },
            { key: "growth", label: "Growth %", kind: "pct" },
          ]}
          groups={lyVsCyGroups} startCollapsed={dimOrder.length > 1} empty="Select a dimension in View By above." />
      </div>

      {completedMonthKeys.length > 0 && salesVsTargetGroups.length > 0 && (
        <div>
          <SectionHeader title="Sales vs Target of Completed Months" />
          <DataTable key={dimsKey}
            cols={[
              { key: "name", label: "Name" },
              { key: "target", label: "Target", kind: "money", total: true },
              { key: "sales", label: "Sales", kind: "money", total: true },
              { key: "achieved", label: "% Achieved", kind: "pct" },
            ]}
            groups={salesVsTargetGroups} empty="No target entered yet for these cost centres — set one on Accounting → Targets & Budget." />
        </div>
      )}

      <div>
        <SectionHeader title="Cost Centre Group → Cost Centre — Target, Current Year vs Previous Year" />
        <DataTable
          cols={[
            { key: "name", label: "Cost Centre", href: (r: any) => `/accounting/transactions?cc=${encodeURIComponent(r.name)}&from=${ym.year}-01-01&to=${ym.year}-12-31` },
            { key: "target", label: "Target", kind: "money", total: true },
            { key: "current_year", label: "Current Year", kind: "money", total: true },
            { key: "previous_year", label: "Previous Year", kind: "money", total: true },
            { key: "difference", label: "Difference", kind: "money", total: true },
            { key: "difference_pct", label: "Difference %", kind: "pct" },
            { key: "contribution", label: "Contribution %", kind: "pct" },
          ]}
          groups={ccGroups} empty="No sales in this period." />
      </div>

      {monthKeys.length > 1 && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <SectionHeader title="Monthwise Sales" />
            <div className="flex gap-1 print:hidden">
              <button onClick={() => setShowValue((v) => showQty ? !v : true)}
                className={`rounded-full px-3 py-1 text-sm ${showValue ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>Value</button>
              <button onClick={() => setShowQty((v) => showValue ? !v : true)}
                className={`rounded-full px-3 py-1 text-sm ${showQty ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>Qty</button>
            </div>
          </div>
          <MonthwisePivotTable key={dimsKey} nodes={pivotNodes} monthKeys={monthKeys} showValue={showValue} showQty={showQty} />
        </div>
      )}

      <div>
        <SectionHeader title="Monthly" />
        <DataTable
          cols={[
            { key: "month_label", label: "Month" },
            { key: "txns", label: "Quantity (Txns)", kind: "int" },
            { key: "amount", label: "Sales", kind: "money", total: true },
            { key: "average", label: "Average Sale", kind: "money" },
          ]}
          rows={monthlyRows} empty="No sales in this period." />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionHeader title="By Customer" />
          <DataTable
            cols={[
              { key: "name", label: "Customer", href: (r: any) => r.account_id ? `/accounting/customers/${r.account_id}` : null },
              { key: "txns", label: "Transactions", kind: "int" },
              { key: "amount", label: "Sales", kind: "money", total: true },
              { key: "contribution", label: "Contribution %", kind: "pct" },
            ]}
            rows={customerRows} empty="No sales in this period." />
        </div>
        <div>
          <SectionHeader title="By Product / Vehicle / Service" />
          <DataTable
            cols={[
              { key: "name", label: "Product / Vehicle / Service" },
              { key: "qty", label: "Qty", kind: "qty" },
              { key: "amount", label: "Sales", kind: "money", total: true },
            ]}
            rows={s.by_product} empty="No product-level sales in this period." />
        </div>
      </div>
    </div>
  );
}
