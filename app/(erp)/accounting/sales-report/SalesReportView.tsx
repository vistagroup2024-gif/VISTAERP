"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
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
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const EMPTY = {
  total: 0, txns: 0, monthly: [] as any[], by_cost_centre: [] as any[], by_cc_month: [] as any[],
  by_customer: [] as any[], by_customer_month: [] as any[], by_product: [] as any[], by_product_month: [] as any[],
};
type SalesData = typeof EMPTY;

// Name x month -> {amount, qty} for whichever dimension (CC Group, Cost
// Centre, Customer, Product) the Monthwise Sales pivot is on — Value/Qty are
// both carried per cell so the toggle just picks which one to display,
// rather than re-fetching or re-deriving anything.
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
  return Array.from(map.values());
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
    by_customer_month: parts.flatMap((p) => p.by_customer_month ?? []),
    by_product_month: parts.flatMap((p) => p.by_product_month ?? []),
    by_cost_centre: mergeByKey(parts.map((p) => p.by_cost_centre), (r) => r.name, ["amount", "txns"]),
    by_customer: mergeByKey(parts.map((p) => p.by_customer), (r) => r.account_id ?? r.name, ["amount", "txns"]),
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
  const [pivotDim, setPivotDim] = useState<"ccGroup" | "costCentre" | "customer" | "product">("costCentre");
  const [pivotMode, setPivotMode] = useState<"value" | "qty">("value");

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

  // Monthwise Sales pivot — the months actually selected, as columns; rows
  // are whichever dimension is picked (CC Group, Cost Centre, Customer,
  // Product). CC Group is by_cc_month rolled up one level (the field is
  // already on every row); Cost Centre, Customer and Product each read
  // their own *_month array directly — no new calculation, the same
  // finer-grouping-of-an-existing-total shape 431's by_cc_month set.
  const selectedMonths = Array.from(new Set(ym.months)).sort((a, b) => a - b);
  const monthKeys = selectedMonths.map((m) => `${ym.year}-${String(m).padStart(2, "0")}`);

  const ccGroupMonthly = useMemo(() => {
    const m = new Map<string, { name: string; month: string; amount: number; qty: number }>();
    for (const r of s.by_cc_month) {
      const key = `${r.cost_center_group}::${r.month}`;
      const existing = m.get(key) ?? { name: r.cost_center_group, month: r.month, amount: 0, qty: 0 };
      existing.amount += Number(r.amount || 0); existing.qty += Number(r.txns || 0);
      m.set(key, existing);
    }
    return Array.from(m.values());
  }, [s.by_cc_month]);
  const costCentreMonthly = s.by_cc_month.map((r: any) => ({ name: r.cost_center, month: r.month, amount: Number(r.amount || 0), qty: Number(r.txns || 0) }));
  const customerMonthly = s.by_customer_month.map((r: any) => ({ name: r.name, month: r.month, amount: Number(r.amount || 0), qty: Number(r.txns || 0) }));
  const productMonthly = s.by_product_month.map((r: any) => ({ name: r.name, month: r.month, amount: Number(r.amount || 0), qty: Number(r.qty || 0) }));
  const pivotSource = pivotDim === "ccGroup" ? ccGroupMonthly : pivotDim === "costCentre" ? costCentreMonthly : pivotDim === "customer" ? customerMonthly : productMonthly;
  const pivotRows = buildPivot(pivotSource).sort((a, b) => b.total.amount - a.total.amount);
  const pivotQtyLabel = pivotDim === "product" ? "Qty" : "Txns";

  // Cost Centre Group share of total — the same ccGroups rollup the nested
  // table already built, read for its totals rather than recomputed.
  const ccGroupChartData = ccGroups.map((g) => ({ name: g.label, amount: Number(g.subtotal!.current_year) }));

  const monthlyRows = s.monthly.map((m: any) => {
    const [, mm] = m.month.split("-");
    return { month: m.month, month_label: `${MONTH_NAMES[Number(mm) - 1]} ${m.month.slice(0, 4)}`, txns: m.txns, amount: m.amount, average: m.txns > 0 ? Number(m.amount) / m.txns : 0 };
  }).sort((a: any, b: any) => a.month.localeCompare(b.month));

  const customerRows = s.by_customer.map((r: any) => ({
    ...r, contribution: Number(s.total) !== 0 ? (Number(r.amount) / Number(s.total)) * 100 : 0,
  })).sort((a: any, b: any) => b.amount - a.amount);

  return (
    <div className="space-y-4">
      <PageHeader title="Sales Report">
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Summary — {periodLabel(ym)}{loading ? " (loading…)" : ""}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <ReportKpi label="Total Sales (period)" value={money(s.total)} icon="sales" tone="info" />
          <ReportKpi label="Current Month" value={money(curMonth.total)} icon="sales" />
          <ReportKpi label="Previous Month" value={money(prevMonth.total)} icon="sales" />
          <ReportKpi label="Previous Year (same months)" value={money(py.total)} icon="sales" />
          <ReportKpi label="Target" value={money(totalTarget)} icon="trendUp" />
          <ReportKpi label="Achievement %" value={achievement === null ? "No target set" : `${achievement.toFixed(1)}%`} icon="trendUp"
            tone={achievement !== null ? (achievement >= 100 ? "pos" : achievement >= 80 ? "warn" : "neg") : undefined} />
          <ReportKpi label="Difference vs Target" value={money(Number(s.total) - totalTarget)} icon="trendUp" tone={Number(s.total) - totalTarget >= 0 ? "pos" : "neg"} />
          <ReportKpi label="Transactions" value={String(s.txns)} icon="receipt" />
          <ReportKpi label="Quantity" value={new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(totalQty)} icon="inventory" />
          <ReportKpi label="Average Sale" value={money(avgSale)} icon="sales" />
        </div>
      </div>

      {s.monthly.length > 1 && (
        <div className="card">
          <SectionHeader title="Monthly Trend" />
          <TrendChart data={monthlyRows} xKey="month" series={[{ key: "amount", label: "Sales" }]} />
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
            <div className="flex flex-wrap items-center gap-3 print:hidden">
              <div className="flex gap-1">
                {([["ccGroup", "CC Group"], ["costCentre", "Cost Centre"], ["customer", "Customer"], ["product", "Product"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setPivotDim(k)}
                    className={`rounded-full px-3 py-1 text-sm ${pivotDim === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>{l}</button>
                ))}
              </div>
              <div className="flex gap-1">
                {([["value", "Value"], ["qty", pivotQtyLabel]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setPivotMode(k)}
                    className={`rounded-full px-3 py-1 text-sm ${pivotMode === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="card overflow-x-auto p-0 text-sm">
            <table className="report-grid w-full">
              <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
                <tr>
                  <th className="px-3 py-2 text-left">{pivotDim === "ccGroup" ? "CC Group" : pivotDim === "costCentre" ? "Cost Centre" : pivotDim === "customer" ? "Customer" : "Product"}</th>
                  {monthKeys.map((mk) => <th key={mk} className="px-3 py-2 text-right">{MONTH_NAMES[Number(mk.slice(5, 7)) - 1]}</th>)}
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {pivotRows.map((row) => (
                  <tr key={row.key}>
                    <td className="px-3 py-1.5">{row.label}</td>
                    {monthKeys.map((mk) => {
                      const v = pivotMode === "value" ? row.cells[mk]?.amount : row.cells[mk]?.qty;
                      return <td key={mk} className="px-3 py-1.5 text-right tabular-nums">{v ? (pivotMode === "value" ? money(v) : new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(v)) : "—"}</td>;
                    })}
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                      {pivotMode === "value" ? money(row.total.amount) : new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(row.total.qty)}
                    </td>
                  </tr>
                ))}
                {pivotRows.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={monthKeys.length + 2}>No sales in this period.</td></tr>}
              </tbody>
              {pivotRows.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-3 py-1.5">Total</td>
                    {monthKeys.map((mk) => {
                      const colTotal = pivotRows.reduce((s, r) => s + (pivotMode === "value" ? (r.cells[mk]?.amount ?? 0) : (r.cells[mk]?.qty ?? 0)), 0);
                      return <td key={mk} className="px-3 py-1.5 text-right tabular-nums">{pivotMode === "value" ? money(colTotal) : new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(colTotal)}</td>;
                    })}
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {pivotMode === "value" ? money(Number(s.total)) : new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(pivotRows.reduce((s, r) => s + r.total.qty, 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
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
