"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { monthShort } from "@/lib/format";
import { defaultYearMonths, monthRanges, periodLabel, type YearMonths } from "@/lib/reports/period";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import TrendChart from "@/components/reports/charts/TrendChart";
import DataTable, { type DataGroup } from "@/components/reports/DataTable";
import ReportKpi from "@/components/reports/ReportKpi";
import SectionHeader from "@/components/reports/SectionHeader";

const money = (n: any) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

// Non-contiguous month picks (e.g. Jan + Mar) call report_cost_centre_costing
// once per contiguous run and merge here — the common case (all months, or
// any single run) is one call, exactly as before. Each cost centre's own
// `monthly` array is a straight concatenation (the ranges never overlap a
// month), everything else summed the same way Sales Report merges its parts.
function mergeCcc(parts: any[][]): any[] {
  if (parts.length <= 1) return parts[0] ?? [];
  const byName = new Map<string, any>();
  for (const part of parts) for (const r of part) {
    const existing = byName.get(r.cost_centre);
    if (!existing) { byName.set(r.cost_centre, { ...r, monthly: [...(r.monthly ?? [])] }); continue; }
    for (const k of ["sales", "variance", "cogs", "gross_profit", "expense", "direct_expense", "indirect_expense", "net_profit"]) {
      existing[k] = Number(existing[k] || 0) + Number(r[k] || 0);
    }
    existing.target = Math.max(existing.target, r.target); // target is a period total, not additive per range
    existing.gp_pct = existing.sales !== 0 ? ((existing.sales - existing.cogs) / existing.sales) * 100 : null;
    existing.achievement = existing.target > 0 ? (existing.sales / existing.target) * 100 : null;
    existing.monthly = [...existing.monthly, ...(r.monthly ?? [])];
    byName.set(r.cost_centre, existing);
  }
  return Array.from(byName.values());
}

// Cost Centre Costing — report_cost_centre_costing() (417, extended 431 for
// cost_center_group and a per-cost-centre monthly breakdown), the same
// income/COGS/expense definitions the P&L and dashboard already use. Year +
// Months replaces the old From/To form; Group -> Cost Centre -> Month is a
// real expandable hierarchy off acct_cost_centers.parent_id, not invented.
export default function CostCentreCostingView() {
  const sb = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths());
  const [rows, setRows] = useState<any[]>([]);
  const [monthly, setMonthly] = useState<{ month: string; amount: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const ranges = monthRanges(ym);
    Promise.all(ranges.map((r) => sb.rpc("report_cost_centre_costing", { p_from: r.from, p_to: r.to }).then(({ data }) => (data as any[]) ?? [])))
      .then((parts) => {
        if (!live) return;
        const merged = mergeCcc(parts).filter((r) => r.sales || r.cogs || r.expense || r.target);
        setRows(merged);
        // Monthly trend built off the same per-cost-centre monthly arrays
        // report_cost_centre_costing already returns (migration 431) — not
        // a second RPC call, just this component's own re-aggregation of
        // what was already fetched for the hierarchy below.
        const byMonth = new Map<string, number>();
        for (const r of merged) for (const m of r.monthly ?? []) {
          byMonth.set(m.month, (byMonth.get(m.month) ?? 0) + Number(m.sales || 0));
        }
        setMonthly(Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount })));
        setLoading(false);
      });
    return () => { live = false; };
  }, [sb, ym.year, ym.months.join(",")]);

  const t = rows.reduce((a, r) => ({
    target: a.target + Number(r.target || 0), sales: a.sales + Number(r.sales || 0),
    cogs: a.cogs + Number(r.cogs || 0), gross_profit: a.gross_profit + Number(r.gross_profit || 0),
    expense: a.expense + Number(r.expense || 0), net_profit: a.net_profit + Number(r.net_profit || 0),
    direct_expense: a.direct_expense + Number(r.direct_expense || 0), indirect_expense: a.indirect_expense + Number(r.indirect_expense || 0),
  }), { target: 0, sales: 0, cogs: 0, gross_profit: 0, expense: 0, net_profit: 0, direct_expense: 0, indirect_expense: 0 });
  const achievement = t.target > 0 ? (t.sales / t.target) * 100 : null;
  const gpPct = t.sales !== 0 ? (t.gross_profit / t.sales) * 100 : null;

  // Group -> Cost Centre -> Month. A cost centre's own row is its annual
  // figures (target/achievement/direct+indirect split kept in the meta
  // annotation, not dropped); expanding it opens the same P&L shape,
  // month by month, off the identical source rows.
  const groupMap = new Map<string, any[]>();
  for (const r of rows) {
    const arr = groupMap.get(r.cost_center_group) ?? [];
    arr.push(r);
    groupMap.set(r.cost_center_group, arr);
  }
  const groups: DataGroup[] = Array.from(groupMap.entries()).map(([group, ccRows]) => {
    ccRows.sort((a, b) => b.sales - a.sales);
    const groupTotal = ccRows.reduce((a, r) => a + Number(r.sales || 0), 0);
    const groupNet = ccRows.reduce((a, r) => a + Number(r.net_profit || 0), 0);
    return {
      key: group, label: group,
      meta: <span className="ml-2 font-normal text-slate-500">— sales {money(groupTotal)}, net {money(groupNet)}</span>,
      rows: [],
      subgroups: ccRows.map((r) => ({
        key: `${group}::${r.cost_centre}`, label: r.cost_centre,
        meta: (
          <span className="ml-2 font-normal text-slate-500">
            — target {money(r.target)}{r.achievement !== null ? ` (${Number(r.achievement).toFixed(0)}%)` : ""}, direct {money(r.direct_expense)}, indirect {money(r.indirect_expense)}
          </span>
        ),
        rows: (r.monthly ?? []).map((m: any) => ({
          row_label: monthShort(m.month),
          sales: m.sales, cogs: m.cogs, gross_profit: m.gross_profit,
          gp_pct: Number(m.sales) !== 0 ? (Number(m.gross_profit) / Number(m.sales)) * 100 : null,
          expense: m.expense, net_profit: m.net_profit,
        })),
        subtotal: { sales: r.sales, cogs: r.cogs, gross_profit: r.gross_profit, expense: r.expense, net_profit: r.net_profit },
      })),
    };
  }).sort((a, b) => {
    const at = a.subgroups!.reduce((s, g) => s + Number(g.subtotal?.sales ?? 0), 0);
    const bt = b.subgroups!.reduce((s, g) => s + Number(g.subtotal?.sales ?? 0), 0);
    return bt - at;
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Cost Centre Costing">
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ReportKpi label="Target" value={money(t.target)} icon="trendUp" />
        <ReportKpi label="Sales" value={money(t.sales)} icon="sales" tone="info" />
        <ReportKpi label="Achievement %" value={achievement === null ? "—" : `${achievement.toFixed(1)}%`} icon="trendUp" />
        <ReportKpi label="Gross Profit" value={money(t.gross_profit)} icon="wallet" tone={t.gross_profit >= 0 ? "pos" : "neg"} />
        <ReportKpi label="GP %" value={gpPct === null ? "—" : `${gpPct.toFixed(1)}%`} icon="wallet" />
        <ReportKpi label="Expense" value={money(t.expense)} icon="receipt" tone="neg" />
        <ReportKpi label="Net Profit" value={money(t.net_profit)} icon="accounting" tone={t.net_profit >= 0 ? "pos" : "neg"} />
      </div>

      {monthly.length > 1 && (
        <div className="card">
          <SectionHeader title="Monthly Sales Trend" />
          <TrendChart data={monthly.map((m) => ({ ...m, month: monthShort(m.month) }))} xKey="month" series={[{ key: "amount", label: "Sales" }]} />
        </div>
      )}

      <div>
        <SectionHeader title={`Cost Centre Group → Cost Centre → Month — ${periodLabel(ym)}${loading ? " (loading…)" : ""}`} />
        <DataTable
          cols={[
            { key: "row_label", label: "Cost Centre / Month" },
            { key: "sales", label: "Sales", kind: "money", total: true },
            { key: "cogs", label: "COGS", kind: "money", total: true },
            { key: "gross_profit", label: "Gross Profit", kind: "money", total: true },
            { key: "gp_pct", label: "GP %", kind: "pct" },
            { key: "expense", label: "Expense", kind: "money", total: true },
            { key: "net_profit", label: "Net Profit", kind: "money", total: true },
          ]}
          groups={groups} empty="No activity for this period." />
      </div>
    </div>
  );
}
