"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDocRights } from "@/components/AccessProvider";

type Slip = { id: string; employee: string; basic: number; allowances: number; deductions: number; net: number };
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const now = new Date();

export default function PayrollRun() {
  const rights = useDocRights("payroll");
  const router = useRouter();
  const supabase = createClient();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [slips, setSlips] = useState<Slip[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadSlips(rid: string) {
    const { data } = await supabase.from("payslips").select("id, basic, allowances, deductions, net, employees(name)").eq("run_id", rid);
    setSlips(((data as any[]) ?? []).map((s) => ({ id: s.id, employee: s.employees?.name ?? "—", basic: s.basic, allowances: s.allowances, deductions: s.deductions, net: s.net })));
  }
  async function generate() {
    setErr(null); setDone(null); setBusy(true);
    const { data, error } = await supabase.rpc("payroll_generate", { p_year: year, p_month: month });
    setBusy(false);
    if (error) return setErr(error.message);
    const r = data as any; setRunId(r.run_id); setStatus("draft");
    await loadSlips(r.run_id);
    setDone(`${r.employees} payslip(s) generated`);
  }
  async function post() {
    if (!runId) return;
    setErr(null); setBusy(true);
    const { data, error } = await supabase.rpc("payroll_post", { p_run: runId });
    setBusy(false);
    if (error) return setErr(error.message);
    const r = data as any; setStatus("posted");
    setDone(`Posted to GL — gross ${money(r.gross)}, net ${money(r.net)}`);
    router.refresh();
  }

  const tot = slips.reduce((a, s) => ({ b: a.b + s.basic, al: a.al + s.allowances, d: a.d + s.deductions, n: a.n + s.net }), { b: 0, al: 0, d: 0, n: 0 });

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3">
        <div><label className="label">Month</label>
          <select className="input" value={month} onChange={(e) => { setMonth(Number(e.target.value)); setRunId(null); setSlips([]); }}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select></div>
        <div><label className="label">Year</label>
          <input type="number" className="input w-28" value={year} onChange={(e) => { setYear(Number(e.target.value) || now.getFullYear()); setRunId(null); setSlips([]); }} /></div>
        <button onClick={generate} disabled={busy || !rights.canCreate} title={rights.denied("create")} className="btn disabled:opacity-40">{busy ? "…" : "Generate payslips"}</button>
        {runId && status !== "posted" && <button onClick={post} disabled={busy || !rights.canEdit} title={rights.denied("edit")} className="btn-outline disabled:opacity-40">Post to GL</button>}
        {status && <span className={`rounded-full px-3 py-1 text-sm ${status === "posted" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{status}</span>}
      </div>
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {done && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{done}</div>}

      {slips.length > 0 && (
        <div className="card overflow-x-auto p-0 text-sm">
          <table className="w-full">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr><th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-right">Basic</th>
                <th className="px-3 py-2 text-right">Allowances</th><th className="px-3 py-2 text-right">Deductions</th><th className="px-3 py-2 text-right">Net</th></tr>
            </thead>
            <tbody>
              {slips.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{s.employee}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(s.basic)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(s.allowances)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(s.deductions)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{money(s.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-3 py-2">Total ({slips.length})</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(tot.b)}</td><td className="px-3 py-2 text-right tabular-nums">{money(tot.al)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(tot.d)}</td><td className="px-3 py-2 text-right tabular-nums">{money(tot.n)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
