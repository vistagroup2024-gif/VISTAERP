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

// Every breakdown on this report — the LY vs CY comparison, the Monthwise
// pivot, and Sales vs Target — is a view of the same sales data sliced by
// one of these four dimensions. A user wanting Cost Centre AND Customer
// side by side is asking to see two independent slices at once, the same
// multi-select test this file's own convention already states elsewhere
// (a pivot dimension is single-select only when the options are mutually
// exclusive views of ONE thing — these are four different things to slice
// the same total by, not states of each other). "View By" below is one
// shared multi-select governing every dimension-aware section on the page,
// rather than each section keeping its own separate single-select picker.
type Dim = "ccGroup" | "costCentre" | "customer" | "product";
const DIM_ORDER: Dim[] = ["ccGroup", "costCentre", "customer", "product"];
const DIM_LABEL: Record<Dim, string> = { ccGroup: "CC Group", costCentre: "Cost Centre", customer: "Customer", product: "Product" };
// Only Cost Centre Group and Cost Centre carry a target (acct_cost_center_monthly_targets
// is keyed on a cost centre) — a customer or a product has no target concept
// in this schema, so Sales vs Target only ever renders for these two.
const TARGET_DIMS: Dim[] = ["ccGroup", "costCentre"];

// Name x month -> {amount, qty} for whichever dimension the Monthwise Sales
// pivot is on — Value/Qty are both carried per cell so the toggle just picks
// which one to display, rather than re-fetching or re-deriving anything.
type MonthCell = { amount: number; qty: number };
type PivotRow = { key: string; label: string; cells: Record<string, MonthCell>; total: MonthCell };
function buildPivot(items: { name: string; month: string; amount: number; qty: number }[]): PivotRow[] {
  const map = new Map<string, PivotRow>();
  for (const it of items) {
    let row = map.get(it.name);
    if (!row) { row = { key: it.name, label: it.name, cells: {}, total: { amount: 0, qty: 0 } }; map.set(it.name, row); }
    const cell = row.cells[it.month] ?? { amount: 0, qty: 0 };
    cell.amount += it.amount; cell.qty += it.qty;
    row.cells[it.month] = cell;
    row.total.amount += it.amount; row.total.qty += it.qty;
  }
  return Array.from(map.values()).sort((a, b) => b.total.amount - a.total.amount);
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

// One LY-vs-CY row per entity in a dimension's current-period array, matched
// to its previous-year counterpart by the same key both arrays already use.
function lyVsCy(cur: any[], prev: any[], keyFn: (r: any) => string): { name: string; ly: number; cy: number; growth: number | null }[] {
  const prevMap = new Map(prev.map((r) => [keyFn(r), Number(r.amount || 0)]));
  return cur.map((r) => {
    const cy = Number(r.amount || 0);
    const ly = prevMap.get(keyFn(r)) ?? 0;
    return { name: r.name, ly, cy, growth: ly ? ((cy - ly) / Math.abs(ly)) * 100 : null };
  }).sort((a, b) => b.cy - a.cy);
}

const PIVOT_COLS = (monthKeys: string[], showValue: boolean, showQty: boolean) => monthKeys.length * ((showValue ? 1 : 0) + (showQty ? 1 : 0)) + 1 + (showValue ? 1 : 0) + (showQty ? 1 : 0);

// One Monthwise pivot table — rows are whichever dimension it's given,
// columns are the selected months. Rendered once per dimension in "View By".
function MonthwisePivotTable({ label, rows, monthKeys, showValue, showQty, grandTotal }: {
  label: string; rows: PivotRow[]; monthKeys: string[]; showValue: boolean; showQty: boolean; grandTotal: number;
}) {
  return (
    <div className="card overflow-x-auto p-0 text-sm">
      <table className="report-grid w-full">
        <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
          <tr>
            <th className="px-3 py-2 text-left" rowSpan={2}><span className="col-resize">{label}</span></th>
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
          {rows.map((row, i) => (
            <tr key={row.key} className={i % 2 === 1 ? "bg-slate-50/70" : ""}>
              <td className="px-3 py-1.5">{row.label}</td>
              {monthKeys.map((mk) => (
                <Fragment key={mk}>
                  {showValue && <td className="px-2 py-1.5 text-right tabular-nums">{row.cells[mk]?.amount ? money(row.cells[mk].amount) : "—"}</td>}
                  {showQty && <td className="px-2 py-1.5 text-right tabular-nums">{row.cells[mk]?.qty ? qtyFmt(row.cells[mk].qty) : "—"}</td>}
                </Fragment>
              ))}
              {showValue && <td className="px-2 py-1.5 text-right font-medium tabular-nums">{money(row.total.amount)}</td>}
              {showQty && <td className="px-2 py-1.5 text-right font-medium tabular-nums">{qtyFmt(row.total.qty)}</td>}
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={PIVOT_COLS(monthKeys, showValue, showQty)}>No sales in this period.</td></tr>}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="bg-slate-50 font-semibold">
              <td className="px-3 py-1.5">Total</td>
              {monthKeys.map((mk) => {
                const colValueTotal = rows.reduce((s, r) => s + (r.cells[mk]?.amount ?? 0), 0);
                const colQtyTotal = rows.reduce((s, r) => s + (r.cells[mk]?.qty ?? 0), 0);
                return (
                  <Fragment key={mk}>
                    {showValue && <td className="px-2 py-1.5 text-right tabular-nums">{money(colValueTotal)}</td>}
                    {showQty && <td className="px-2 py-1.5 text-right tabular-nums">{qtyFmt(colQtyTotal)}</td>}
                  </Fragment>
                );
              })}
              {showValue && <td className="px-2 py-1.5 text-right tabular-nums">{money(grandTotal)}</td>}
              {showQty && <td className="px-2 py-1.5 text-right tabular-nums">{qtyFmt(rows.reduce((s, r) => s + r.total.qty, 0))}</td>}
            </tr>
          </tfoot>
        )}
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
  const [loading, setLoading] = useState(true);
  const [dims, setDims] = useState<Set<Dim>>(() => new Set<Dim>(["ccGroup"]));
  // Both can be on at once — "if we want to see qty + value so both should
  // come" — at least one stays on so the grid is never empty.
  const [showValue, setShowValue] = useState(true);
  const [showQty, setShowQty] = useState(false);

  function toggleDim(d: Dim) {
    setDims((prev) => {
      const next = new Set(prev);
      if (next.has(d)) { if (next.size > 1) next.delete(d); } else next.add(d);
      return next;
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

    Promise.all([
      fetchSales(sb, ym),
      fetchSales(sb, { year: ym.year - 1, months: ym.months }),
      sb.rpc("report_sales", { p_company: COMPANY_ID, p_from: monthStartSA(), p_to: todaySA() }).then(({ data }) => (data as SalesData) ?? EMPTY),
      sb.rpc("report_sales", { p_company: COMPANY_ID, p_from: lmFrom, p_to: lmTo }).then(({ data }) => (data as SalesData) ?? EMPTY),
      sb.rpc("report_cost_center_targets", { p_from: from, p_to: to }).then(({ data }) => (data as any[]) ?? []),
    ]).then(([sData, pyData, cm, pm, tg]) => {
      if (!live) return;
      setS(sData); setPy(pyData); setCurMonth(cm); setPrevMonth(pm);
      setTargets(tg.filter((r) => Number(r.actual || 0) || Number(r.target || 0)));
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
    rows.sort((a, b) => b.current_year - a.current_year);
    return {
      key: group, label: group,
      meta: <span className="ml-2 font-normal text-slate-500">— {money(groupTotal)}{groupTarget > 0 ? ` of ${money(groupTarget)} target (${((groupTotal / groupTarget) * 100).toFixed(0)}%)` : ""}</span>,
      rows,
      subtotal: { current_year: groupTotal, previous_year: rows.reduce((a, r) => a + r.previous_year, 0), difference: rows.reduce((a, r) => a + r.difference, 0), target: groupTarget },
    };
  }).sort((a, b) => (b.subtotal!.current_year ?? 0) - (a.subtotal!.current_year ?? 0));

  // LY vs CY, one flat table per selected "View By" dimension — the old
  // software's own "Cost Center Group wise Sales" table, generalised so it
  // isn't stuck at Group level: Cost Centre, Customer and Product all carry
  // both a current- and previous-year array already (py is fetched in full,
  // same shape as s), so the same lyVsCy() merge works for all four.
  const lyVsCyByDim: Record<Dim, { name: string; ly: number; cy: number; growth: number | null }[]> = {
    ccGroup: ccGroups.map((g) => ({
      name: g.label, ly: Number(g.subtotal!.previous_year), cy: Number(g.subtotal!.current_year),
      growth: g.subtotal!.previous_year ? ((Number(g.subtotal!.current_year) - Number(g.subtotal!.previous_year)) / Math.abs(Number(g.subtotal!.previous_year))) * 100 : null,
    })),
    costCentre: lyVsCy(s.by_cost_centre, py.by_cost_centre, (r) => r.name),
    customer: lyVsCy(s.by_customer, py.by_customer, (r) => r.account_id ?? r.name),
    product: lyVsCy(s.by_product, py.by_product, (r) => r.name),
  };

  // Monthwise Sales pivot sources — the months actually selected, as
  // columns; rows are whichever dimension(s) are picked. CC Group is
  // by_cc_month rolled up one level (the field is already on every row);
  // Cost Centre, Customer and Product each read their own *_month array
  // directly — no new calculation, the same finer-grouping-of-an-existing-
  // total shape 431's by_cc_month set.
  const selectedMonths = Array.from(new Set(ym.months)).sort((a, b) => a - b);
  const monthKeys = selectedMonths.map((m) => `${ym.year}-${String(m).padStart(2, "0")}`);

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
  const customerMonthly = s.by_customer_month.map((r: any) => ({ name: r.name, month: r.month, amount: Number(r.amount || 0), qty: Number(r.qty || 0) }));
  const productMonthly = s.by_product_month.map((r: any) => ({ name: r.name, month: r.month, amount: Number(r.amount || 0), qty: Number(r.qty || 0) }));
  const pivotSourceByDim: Record<Dim, typeof ccGroupMonthly> = { ccGroup: ccGroupMonthly, costCentre: costCentreMonthly, customer: customerMonthly, product: productMonthly };

  // Sales vs Target of Completed Months — the old software's own table,
  // scoped to months that have actually ended (a month "in progress" isn't
  // measured against its target yet). by_cc_month_target (436) carries both
  // the leaf cost_center and its cost_center_group per row, so the same
  // source drives either granularity ccGroup/costCentre selects. A month is
  // "completed" once the NEXT month has started — comparing wall-clock
  // Riyadh "today" against it, never the selected period's own end date.
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
  const ccGroupChartData = ccGroups.map((g) => ({ name: g.label, amount: Number(g.subtotal!.current_year) }));

  const monthlyRows = s.monthly.map((m: any) => ({
    month: m.month, month_label: monthShort(m.month), txns: m.txns, amount: m.amount, average: m.txns > 0 ? Number(m.amount) / m.txns : 0,
  })).sort((a: any, b: any) => a.month.localeCompare(b.month));

  const customerRows = s.by_customer.map((r: any) => ({
    ...r, contribution: Number(s.total) !== 0 ? (Number(r.amount) / Number(s.total)) * 100 : 0,
  })).sort((a: any, b: any) => b.amount - a.amount);

  const activeDims = DIM_ORDER.filter((d) => dims.has(d));
  const activeTargetDims = TARGET_DIMS.filter((d) => dims.has(d));

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

      {/* Shared multi-select — governs every dimension-aware section below
          (LY vs CY, Sales vs Target, Monthwise Sales): pick any combination
          of CC Group / Cost Centre / Customer / Product and see all of them
          at once, rather than one exclusive tab hiding the others. */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">View By</span>
        <div className="flex flex-wrap gap-1">
          {DIM_ORDER.map((d) => (
            <button key={d} onClick={() => toggleDim(d)}
              className={`rounded-full px-3 py-1 text-sm ${dims.has(d) ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
              {DIM_LABEL[d]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {activeDims.map((d) => (
          <div key={d}>
            <SectionHeader title={`${DIM_LABEL[d]} wise Sales — LY vs CY`} />
            <DataTable
              cols={[
                { key: "name", label: DIM_LABEL[d] },
                { key: "ly", label: "LY Sales", kind: "money", total: true },
                { key: "cy", label: "CY Sales", kind: "money", total: true },
                { key: "growth", label: "Growth %", kind: "pct" },
              ]}
              rows={lyVsCyByDim[d]} empty="No sales in this period." />
          </div>
        ))}
      </div>

      {completedMonthKeys.length > 0 && activeTargetDims.length > 0 && (
        <div className="space-y-4">
          {activeTargetDims.map((d) => (
            <div key={d}>
              <SectionHeader title={`Sales vs Target of Completed Months — ${DIM_LABEL[d]} — ${completedMonthKeys.map((mk) => monthShort(mk)).join(", ")}`} />
              <DataTable
                cols={[
                  { key: "name", label: DIM_LABEL[d] },
                  { key: "target", label: "Target", kind: "money", total: true },
                  { key: "sales", label: "Sales", kind: "money", total: true },
                  { key: "achieved", label: "% Achieved", kind: "pct" },
                ]}
                rows={salesVsTargetForDim(d)} empty="No target entered yet for these cost centres — set one on Accounting → Targets & Budget." />
            </div>
          ))}
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionHeader title="Monthwise Sales" />
            <div className="flex gap-1 print:hidden">
              <button onClick={() => setShowValue((v) => showQty ? !v : true)}
                className={`rounded-full px-3 py-1 text-sm ${showValue ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>Value</button>
              <button onClick={() => setShowQty((v) => showValue ? !v : true)}
                className={`rounded-full px-3 py-1 text-sm ${showQty ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>Qty</button>
            </div>
          </div>
          {activeDims.map((d) => {
            const rows = buildPivot(pivotSourceByDim[d]);
            const grandTotal = rows.reduce((sum, r) => sum + r.total.amount, 0);
            return (
              <div key={d}>
                <h3 className="mb-1 text-sm font-semibold text-slate-600">{DIM_LABEL[d]}</h3>
                <MonthwisePivotTable label={DIM_LABEL[d]} rows={rows} monthKeys={monthKeys} showValue={showValue} showQty={showQty} grandTotal={grandTotal} />
              </div>
            );
          })}
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
