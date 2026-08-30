"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const thisYear = new Date().getFullYear();
const jan = `${thisYear}-01-01`;
const today = new Date().toISOString().slice(0, 10);

type Row = { label: string; target: number; actual: number; variance: number };
type Budget = { account_id: string; code: string; name: string; budget: number; actual: number; variance: number };

export default function TargetsBudget() {
  const supabase = createClient();
  const [tab, setTab] = useState<"cc" | "cust" | "exp">("cc");
  const [from, setFrom] = useState(jan);
  const [to, setTo] = useState(today);
  const [year, setYear] = useState(thisYear);
  const [cc, setCc] = useState<Row[]>([]);
  const [cust, setCust] = useState<Row[]>([]);
  const [exp, setExp] = useState<Budget[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});

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
