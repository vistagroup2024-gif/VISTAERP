"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { todaySA, monthStartSA } from "@/lib/saudiTime";
import { defaultYearMonths, monthRanges, periodLabel, type YearMonths } from "@/lib/reports/period";
import YearMonthsPicker from "@/components/reports/YearMonthsPicker";
import TrendChart from "@/components/reports/charts/TrendChart";
import DataTable, { type DataGroup } from "@/components/reports/DataTable";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

const EMPTY = { total: 0, txns: 0, monthly: [] as any[], by_cost_centre: [] as any[], by_cc_month: [] as any[], by_customer: [] as any[], by_product: [] as any[] };
type SalesData = typeof EMPTY;

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

  // Cost Centre x Month pivot — the months actually selected, as columns;
  // cost centres as rows, grouped the same way the hierarchy above is.
  const selectedMonths = Array.from(new Set(ym.months)).sort((a, b) => a - b);
  const monthKeys = selectedMonths.map((m) => `${ym.year}-${String(m).padStart(2, "0")}`);
  const pivotByCc = new Map<string, Record<string, number>>();
  for (const r of s.by_cc_month) {
    const row = pivotByCc.get(r.cost_center) ?? {};
    row[r.month] = Number(r.amount || 0);
    pivotByCc.set(r.cost_center, row);
  }

  const monthlyRows = s.monthly.map((m: any) => {
    const [, mm] = m.month.split("-");
    return { month: m.month, month_label: `${MONTH_NAMES[Number(mm) - 1]} ${m.month.slice(0, 4)}`, txns: m.txns, amount: m.amount, average: m.txns > 0 ? Number(m.amount) / m.txns : 0 };
  }).sort((a: any, b: any) => a.month.localeCompare(b.month));

  const customerRows = s.by_customer.map((r: any) => ({
    ...r, contribution: Number(s.total) !== 0 ? (Number(r.amount) / Number(s.total)) * 100 : 0,
  })).sort((a: any, b: any) => b.amount - a.amount);

  return (
    <div className="space-y-4">
      <YearMonthsPicker value={ym} onChange={setYm} />

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Summary — {periodLabel(ym)}{loading ? " (loading…)" : ""}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <Kpi label="Total Sales (period)" value={money(s.total)} />
          <Kpi label="Current Month" value={money(curMonth.total)} />
          <Kpi label="Previous Month" value={money(prevMonth.total)} />
          <Kpi label="Previous Year (same months)" value={money(py.total)} />
          <Kpi label="Target" value={money(totalTarget)} />
          <Kpi label="Achievement %" value={achievement === null ? "No target set" : `${achievement.toFixed(1)}%`}
            tone={achievement !== null ? (achievement >= 100 ? "text-green-700" : achievement >= 80 ? "text-amber-700" : "text-red-600") : undefined} />
          <Kpi label="Difference vs Target" value={money(Number(s.total) - totalTarget)} tone={Number(s.total) - totalTarget >= 0 ? "text-green-700" : "text-red-600"} />
          <Kpi label="Transactions" value={String(s.txns)} />
          <Kpi label="Quantity" value={new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(totalQty)} />
          <Kpi label="Average Sale" value={money(avgSale)} />
        </div>
      </div>

      {s.monthly.length > 1 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly Trend</h2>
          <TrendChart data={monthlyRows} xKey="month" series={[{ key: "amount", label: "Sales" }]} />
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Cost Centre Group → Cost Centre — Target, Current Year vs Previous Year</h2>
        <p className="mb-2 text-xs text-slate-400">Click a group to expand it into its own cost centres. Previous Year is the same selected months, one year back.</p>
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

      {monthKeys.length > 1 && pivotByCc.size > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Cost Centre × Month</h2>
          <div className="card overflow-x-auto p-0 text-sm">
            <table className="w-full">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Cost Centre</th>
                  {monthKeys.map((mk) => <th key={mk} className="px-3 py-2 text-right">{MONTH_NAMES[Number(mk.slice(5, 7)) - 1]}</th>)}
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(pivotByCc.entries()).sort((a, b) => {
                  const ta = Object.values(a[1]).reduce((s, v) => s + v, 0), tb = Object.values(b[1]).reduce((s, v) => s + v, 0);
                  return tb - ta;
                }).map(([cc, row]) => {
                  const rowTotal = monthKeys.reduce((s, mk) => s + (row[mk] || 0), 0);
                  return (
                    <tr key={cc} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">{cc}</td>
                      {monthKeys.map((mk) => <td key={mk} className="px-3 py-1.5 text-right tabular-nums">{row[mk] ? money(row[mk]) : "—"}</td>)}
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">{money(rowTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-3 py-1.5">Total</td>
                  {monthKeys.map((mk) => {
                    const colTotal = Array.from(pivotByCc.values()).reduce((s, row) => s + (row[mk] || 0), 0);
                    return <td key={mk} className="px-3 py-1.5 text-right tabular-nums">{money(colTotal)}</td>;
                  })}
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(s.total))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly</h2>
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
          <h2 className="mb-2 text-sm font-semibold text-slate-700">By Customer</h2>
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
          <h2 className="mb-2 text-sm font-semibold text-slate-700">By Product / Vehicle / Service</h2>
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
