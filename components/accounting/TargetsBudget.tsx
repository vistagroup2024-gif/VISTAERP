"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { todaySA, yearSA, monthStartSA } from "@/lib/saudiTime";
import TrendChart from "@/components/reports/charts/TrendChart";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const thisYear = yearSA();
const jan = `${thisYear}-01-01`;
const today = todaySA();

type Row = { label: string; target: number; actual: number; variance: number };
type Budget = { account_id: string; code: string; name: string; budget: number; actual: number; variance: number };
type Analysis = {
  total: number; monthly: { month: string; amount: number }[];
  by_cost_centre: { name: string; amount: number }[]; by_account_group: { name: string; amount: number }[];
  by_account: { account_id: string; code: string; name: string; amount: number }[];
};
const EMPTY_ANALYSIS: Analysis = { total: 0, monthly: [], by_cost_centre: [], by_account_group: [], by_account: [] };

export default function TargetsBudget() {
  const supabase = createClient();
  const params = useSearchParams();
  const initialTab = params.get("tab") === "exp" ? "exp" : params.get("tab") === "cust" ? "cust" : "cc";
  const [tab, setTab] = useState<"cc" | "cust" | "exp">(initialTab);
  const [from, setFrom] = useState(jan);
  const [to, setTo] = useState(today);
  const [year, setYear] = useState(thisYear);
  const [cc, setCc] = useState<Row[]>([]);
  const [cust, setCust] = useState<Row[]>([]);
  const [exp, setExp] = useState<Budget[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [expAnalysis, setExpAnalysis] = useState<Analysis>(EMPTY_ANALYSIS);
  const [expCurMonth, setExpCurMonth] = useState(0);
  const [expYtd, setExpYtd] = useState(0);

  async function loadCc() {
    const { data } = await supabase.rpc("report_cost_center_targets", { p_from: from, p_to: to });
    setCc(((data as any[]) ?? []).map((r) => ({ label: r.cost_center, target: r.target, actual: r.actual, variance: r.variance })));
  }
  async function loadCust() {
    const { data } = await supabase.rpc("report_customer_targets", { p_from: from, p_to: to });
    setCust(((data as any[]) ?? []).map((r) => ({ label: r.customer, target: r.target, actual: r.actual, variance: r.variance })));
  }
  async function loadExp() {
    const { data } = await supabase.rpc("report_expense_budget", { p_year: year });
    setExp((data as Budget[]) ?? []); setDraft({});
    const [{ data: analysis }, { data: cm }, { data: ytd }] = await Promise.all([
      supabase.rpc("report_expense_analysis", { p_company: COMPANY_ID, p_from: `${year}-01-01`, p_to: `${year}-12-31` }),
      supabase.rpc("report_expense_analysis", { p_company: COMPANY_ID, p_from: monthStartSA(), p_to: today }),
      supabase.rpc("report_expense_analysis", { p_company: COMPANY_ID, p_from: `${thisYear}-01-01`, p_to: today }),
    ]);
    setExpAnalysis((analysis as Analysis) ?? EMPTY_ANALYSIS);
    setExpCurMonth(Number((cm as any)?.total ?? 0));
    setExpYtd(Number((ytd as any)?.total ?? 0));
  }
  useEffect(() => { if (tab === "cc") loadCc(); if (tab === "cust") loadCust(); if (tab === "exp") loadExp(); /* eslint-disable-next-line */ }, [tab, from, to, year]);

  async function saveBudget(b: Budget) {
    const v = draft[b.account_id];
    if (v === undefined) return;
    await supabase.from("acct_expense_budgets").upsert(
      { company_id: COMPANY_ID, account_id: b.account_id, year, amount: Number(v) || 0 },
      { onConflict: "company_id,account_id,year" });
    loadExp();
  }

  const Tab = ({ id, label }: { id: typeof tab; label: string }) => (
    <button onClick={() => setTab(id)} className={`px-3 py-1.5 text-sm rounded-t ${tab === id ? "bg-white font-semibold text-brand border-x border-t border-slate-200" : "text-slate-500"}`}>{label}</button>
  );
  const Var = ({ n }: { n: number }) => <span className={`tabular-nums ${n < 0 ? "text-red-600" : "text-green-700"}`}>{money(n)}</span>;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-2 pt-2">
        <Tab id="cc" label="Cost Center Targets" /><Tab id="cust" label="Customer Targets" /><Tab id="exp" label="Expense Budget" />
      </div>

      {tab !== "exp" ? (
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      ) : (
        <div><label className="label">Year</label><input type="number" className="input w-32" value={year} onChange={(e) => setYear(Number(e.target.value) || thisYear)} /></div>
      )}

      {tab === "cc" && <TargetTable head="Cost Center" rows={cc} />}
      {tab === "cust" && <TargetTable head="Customer" rows={cust} />}

      {tab === "exp" && (
        <div className="space-y-3">
          {exp.length > 0 && (() => {
            const totBudget = exp.reduce((s, r) => s + Number(r.budget), 0);
            const totActual = exp.reduce((s, r) => s + Number(r.actual), 0);
            const variance = totBudget - totActual;
            const pct = totBudget > 0 ? (totActual / totBudget) * 100 : null;
            return (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="card"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Budget ({year})</p><p className="mt-1 text-xl font-bold text-slate-800">{money(totBudget)}</p></div>
                <div className="card"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Actual</p><p className="mt-1 text-xl font-bold text-slate-800">{money(totActual)}</p></div>
                <div className="card"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Variance</p><p className={`mt-1 text-xl font-bold ${variance < 0 ? "text-red-600" : "text-green-700"}`}>{money(variance)}</p></div>
                <div className="card"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Used %</p><p className={`mt-1 text-xl font-bold ${pct === null ? "text-slate-800" : pct > 100 ? "text-red-600" : pct > 85 ? "text-amber-700" : "text-slate-800"}`}>{pct === null ? "—" : `${pct.toFixed(1)}%`}</p></div>
              </div>
            );
          })()}

          {/* Read-only analysis — report_expense_analysis() (425), the same
             "expense account" definition report_expense_budget() already
             uses, so its Total always matches the budget table below.
             Current Month / YTD are always today-anchored, independent of
             the Year selector above, matching how Sales Report defines them. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="card"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total Expenses ({year})</p><p className="mt-1 text-xl font-bold text-slate-800">{money(expAnalysis.total)}</p></div>
            <div className="card"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Current Month</p><p className="mt-1 text-xl font-bold text-slate-800">{money(expCurMonth)}</p></div>
            <div className="card"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">YTD ({thisYear})</p><p className="mt-1 text-xl font-bold text-slate-800">{money(expYtd)}</p></div>
          </div>

          {expAnalysis.monthly.length > 1 && (
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Monthly Expense</h3>
              <TrendChart data={expAnalysis.monthly} xKey="month" series={[{ key: "amount", label: "Expense" }]} />
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="card overflow-x-auto p-0 text-sm">
              <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">By Cost Centre</div>
              <table className="w-full">
                <tbody>
                  {expAnalysis.by_cost_centre.map((r) => (
                    <tr key={r.name} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(r.amount)}</td>
                    </tr>
                  ))}
                  {expAnalysis.by_cost_centre.length === 0 && <tr><td className="px-3 py-4 text-center text-slate-400">No activity.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="card overflow-x-auto p-0 text-sm">
              <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">By Account Group</div>
              <table className="w-full">
                <tbody>
                  {expAnalysis.by_account_group.map((r) => (
                    <tr key={r.name} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(r.amount)}</td>
                    </tr>
                  ))}
                  {expAnalysis.by_account_group.length === 0 && <tr><td className="px-3 py-4 text-center text-slate-400">No activity.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card overflow-x-auto p-0 text-sm">
            <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Expense Accounts ({year}) — drill into an account for its transactions</div>
            <table className="w-full">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <tr><th className="px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-right">Amount</th></tr>
              </thead>
              <tbody>
                {expAnalysis.by_account.map((r) => (
                  <tr key={r.account_id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">
                      <Link href={`/accounting/ledger?account=${r.account_id}&from=${year}-01-01&to=${year}-12-31`} className="hover:text-brand hover:underline">
                        {r.code} — {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(r.amount)}</td>
                  </tr>
                ))}
                {expAnalysis.by_account.length === 0 && <tr><td colSpan={2} className="px-3 py-4 text-center text-slate-400">No activity.</td></tr>}
              </tbody>
            </table>
          </div>

          <h3 className="text-sm font-semibold text-slate-700">Budget — editable</h3>
        <div className="card overflow-x-auto p-0 text-sm">
          <table className="w-full">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr><th className="px-3 py-2 text-left">Expense Account</th><th className="px-3 py-2 text-right">Budget</th><th className="px-3 py-2 text-right">Actual</th><th className="px-3 py-2 text-right">Remaining</th><th /></tr>
            </thead>
            <tbody>
              {exp.map((b) => (
                <tr key={b.account_id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{b.name}</td>
                  <td className="px-3 py-2 text-right">
                    <input className="input w-28 text-right tabular-nums" inputMode="decimal"
                      value={draft[b.account_id] ?? String(Number(b.budget))}
                      onChange={(e) => setDraft((d) => ({ ...d, [b.account_id]: e.target.value }))}
                      onBlur={() => saveBudget(b)} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(b.actual)}</td>
                  <td className="px-3 py-2 text-right"><Var n={b.variance} /></td>
                  <td />
                </tr>
              ))}
              {exp.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No expense activity or budgets for {year}.</td></tr>}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  );

  function TargetTable({ head, rows }: { head: string; rows: Row[] }) {
    const tt = rows.reduce((s, r) => s + r.target, 0), ta = rows.reduce((s, r) => s + r.actual, 0);
    return (
      <div className="card overflow-x-auto p-0 text-sm">
        <table className="w-full">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">{head}</th><th className="px-3 py-2 text-right">Target</th><th className="px-3 py-2 text-right">Actual</th><th className="px-3 py-2 text-right">Variance</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.target)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.actual)}</td>
                <td className="px-3 py-2 text-right"><Var n={r.variance} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Nothing to show for this period.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right tabular-nums">{money(tt)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(ta)}</td><td className="px-3 py-2 text-right"><Var n={ta - tt} /></td>
            </tr></tfoot>
          )}
        </table>
      </div>
    );
  }
}
