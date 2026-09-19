"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, monthShort } from "@/lib/format";
import { todaySA, yearSA } from "@/lib/saudiTime";
import TrendChart from "@/components/reports/charts/TrendChart";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const thisYear = yearSA();
const jan = `${thisYear}-01-01`;
const today = todaySA();

type Row = { label: string; group?: string; target: number; actual: number; py: number; variance: number; href?: string | null };
type Monthly = { month: string; amount: number }[];

function pad(n: number) { return String(n).padStart(2, "0"); }
function shiftYear(d: string, delta: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  return `${y + delta}-${pad(m)}-${pad(dd)}`;
}

// This screen used to carry Cost Center Targets and Expense Budget too —
// both moved onto their own masters (Cost Centre's own Targets tab, Chart of
// Accounts' own Budget tab; see CLAUDE.md) and this page dropped from the
// menu (lib/nav.ts's HIDDEN_ITEMS) as a result. Customer Targets stayed:
// it's a report with no master of its own to sit on — a customer's own
// target figure is already edited on Party Details, under Chart of Accounts
// (acct_party_save's p_sales_target) — so there was nowhere to move the
// EDITING to, only somewhere to move the READING from, and this already
// reads report_customer_targets() rather than writing anything itself.
export default function TargetsBudget() {
  const supabase = createClient();
  const [from, setFrom] = useState(jan);
  const [to, setTo] = useState(today);
  const [cust, setCust] = useState<Row[]>([]);
  const [monthly, setMonthly] = useState<Monthly>([]);

  // Monthly Sales Trend is the same series the Sales Report already shows
  // for this from/to — reused, not recomputed, so this page never tells a
  // different month-by-month story than the Sales Report does.
  async function loadMonthly() {
    const { data } = await supabase.rpc("report_sales", { p_company: COMPANY_ID, p_from: from, p_to: to });
    setMonthly(((data as any)?.monthly ?? []) as Monthly);
  }
  async function loadCust() {
    const pyFrom = shiftYear(from, -1), pyTo = shiftYear(to, -1);
    const [{ data }, { data: py }] = await Promise.all([
      supabase.rpc("report_customer_targets", { p_from: from, p_to: to }),
      supabase.rpc("report_customer_targets", { p_from: pyFrom, p_to: pyTo }),
    ]);
    const pyByLabel = new Map(((py as any[]) ?? []).map((r) => [r.customer, Number(r.actual || 0)]));
    setCust(((data as any[]) ?? []).map((r) => ({
      label: r.customer, target: r.target, actual: r.actual,
      py: pyByLabel.get(r.customer) ?? 0, variance: r.variance,
      href: r.account_id ? `/accounting/customers/${r.account_id}` : null,
    })));
  }
  useEffect(() => {
    loadCust(); loadMonthly();
    /* eslint-disable-next-line */
  }, [from, to]);

  const Var = ({ n }: { n: number }) => <span className={`tabular-nums ${n < 0 ? "text-red-600" : "text-green-700"}`}>{money(n)}</span>;

  const t = cust.reduce((a, r) => ({ target: a.target + r.target, actual: a.actual + r.actual, py: a.py + r.py }), { target: 0, actual: 0, py: 0 });
  const achievement = t.target > 0 ? (t.actual / t.target) * 100 : null;
  const yoy = t.py !== 0 ? ((t.actual - t.py) / Math.abs(t.py)) * 100 : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="card"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Target</p><p className="mt-1 text-xl font-bold text-slate-800">{money(t.target)}</p></div>
        <div className="card"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Actual</p><p className="mt-1 text-xl font-bold text-slate-800">{money(t.actual)}</p></div>
        <div className="card"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Achievement %</p><p className="mt-1 text-xl font-bold text-slate-800">{achievement === null ? "—" : `${achievement.toFixed(1)}%`}</p></div>
        <div className="card"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Previous Year (same period)</p><p className="mt-1 text-xl font-bold text-slate-800">{money(t.py)}</p></div>
        <div className="card"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">vs Previous Year</p><p className={`mt-1 text-xl font-bold ${yoy === null ? "text-slate-800" : yoy >= 0 ? "text-green-700" : "text-red-600"}`}>{yoy === null ? "—" : `${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}%`}</p></div>
      </div>
      {monthly.length > 1 && (
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Monthly Sales Trend</h3>
          <TrendChart data={monthly.map((m) => ({ ...m, month: monthShort(m.month) }))} xKey="month" series={[{ key: "amount", label: "Sales" }]} />
        </div>
      )}

      <div className="card overflow-x-auto p-0 text-sm">
        <table className="w-full">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-right">Target</th><th className="px-3 py-2 text-right">Actual</th>
              <th className="px-3 py-2 text-right">Achv %</th>
              <th className="px-3 py-2 text-right">Previous Year</th><th className="px-3 py-2 text-right">vs PY</th>
              <th className="px-3 py-2 text-right">Variance</th>
            </tr>
          </thead>
          <tbody>
            {cust.map((r, i) => {
              const achv = r.target > 0 ? (r.actual / r.target) * 100 : null;
              const rowYoy = r.py !== 0 ? ((r.actual - r.py) / Math.abs(r.py)) * 100 : null;
              const label = r.href ? <Link href={r.href} className="text-brand hover:underline">{r.label}</Link> : r.label;
              return (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-2">{label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.target)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.actual)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{achv === null ? "—" : `${achv.toFixed(1)}%`}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{money(r.py)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${rowYoy === null ? "text-slate-500" : rowYoy >= 0 ? "text-green-700" : "text-red-600"}`}>{rowYoy === null ? "—" : `${rowYoy >= 0 ? "+" : ""}${rowYoy.toFixed(1)}%`}</td>
                  <td className="px-3 py-2 text-right"><Var n={r.variance} /></td>
                </tr>
              );
            })}
            {cust.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Nothing to show for this period.</td></tr>}
          </tbody>
          {cust.length > 0 && (
            <tfoot><tr className="border-t-2 border-slate-400 bg-slate-200 font-bold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(t.target)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(t.actual)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{t.target > 0 ? `${((t.actual / t.target) * 100).toFixed(1)}%` : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(t.py)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{t.py !== 0 ? `${(((t.actual - t.py) / Math.abs(t.py)) * 100).toFixed(1)}%` : "—"}</td>
              <td className="px-3 py-2 text-right"><Var n={t.actual - t.target} /></td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
