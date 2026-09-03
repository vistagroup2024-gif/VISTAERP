"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import AccountPicker, { type PickAccount } from "@/components/accounting/AccountPicker";
import { useDocRights } from "@/components/AccessProvider";

type Sched = { id: string; name: string; cadence: string; next_run: string; narration: string | null; auto_authorize: boolean; active: boolean; last_run: string | null };
type Line = { account: string | null; debit: string; credit: string; remarks: string };
const empty = (): Line => ({ account: null, debit: "", credit: "", remarks: "" });
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function RecurringClient({ schedules, accounts }: { schedules: Sched[]; accounts: PickAccount[] }) {
  const rights = useDocRights("recurring");
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState("monthly");
  const [nextRun, setNextRun] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [autoAuth, setAutoAuth] = useState(true);
  const [lines, setLines] = useState<Line[]>([empty(), empty()]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totals = useMemo(() => {
    let d = 0, c = 0; for (const l of lines) { d += Number(l.debit) || 0; c += Number(l.credit) || 0; }
    return { d, c, diff: +(d - c).toFixed(2) };
  }, [lines]);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => { const n = ls.map((l, j) => (j === i ? { ...l, ...patch } : l)); if (i === n.length - 1 && (patch.account || patch.debit || patch.credit)) n.push(empty()); return n; });
  }

  async function create() {
    setErr(null);
    if (!name) return setErr("Name required");
    if (Math.abs(totals.diff) > 0.005) return setErr("Lines must balance");
    const payload = lines.filter((l) => l.account && (Number(l.debit) || Number(l.credit)))
      .map((l) => ({ account_id: l.account, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.remarks || null }));
    if (payload.length < 2) return setErr("At least two lines");
    setBusy(true);
    const { error } = await supabase.from("recurring_schedules").insert({
      company_id: COMPANY_ID, name, cadence, next_run: nextRun, narration: narration || null,
      lines: payload, auto_authorize: autoAuth,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setName(""); setNarration(""); setLines([empty(), empty()]); router.refresh();
  }
  async function generate() {
    setErr(null); setMsg(null); setBusy(true);
    const { data, error } = await supabase.rpc("generate_recurring", { p_company: COMPANY_ID, p_as_of: new Date().toISOString().slice(0, 10) });
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg(`Generated ${(data as any).generated} due voucher(s).`); router.refresh();
  }
  async function toggle(s: Sched) { await supabase.from("recurring_schedules").update({ active: !s.active }).eq("id", s.id); router.refresh(); }
  async function del(id: string) { if (confirm("Delete schedule?")) { await supabase.from("recurring_schedules").delete().eq("id", id); router.refresh(); } }

  return (
    <div className="space-y-4">
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {msg && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}

      <div className="card flex items-center gap-3">
        <button onClick={generate} disabled={busy || !rights.canCreate} title={rights.denied("create")} className="btn disabled:opacity-40">Generate due now</button>
        <span className="text-xs text-slate-400">Posts every schedule whose next run is today or earlier, then rolls it forward.</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Cadence</th><th className="px-3 py-2 text-left">Next run</th><th className="px-3 py-2 text-left">Last run</th><th className="px-3 py-2 text-center">Auto</th><th className="px-3 py-2 text-center">Active</th><th /></tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5">{s.name}</td><td className="px-3 py-1.5 capitalize">{s.cadence}</td>
                <td className="px-3 py-1.5">{s.next_run}</td><td className="px-3 py-1.5">{s.last_run ?? "—"}</td>
                <td className="px-3 py-1.5 text-center">{s.auto_authorize ? "✓" : "—"}</td>
                <td className="px-3 py-1.5 text-center"><button onClick={() => toggle(s)} disabled={!rights.canEdit} title={rights.denied("edit")} className="hover:underline disabled:opacity-40">{s.active ? "✓" : "off"}</button></td>
                <td className="px-3 py-1.5 text-right"><button onClick={() => del(s.id)} disabled={!rights.canDelete} title={rights.denied("delete")} className="text-red-500 hover:underline disabled:opacity-40">Delete</button></td>
              </tr>
            ))}
            {schedules.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={7}>No schedules.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-700">New schedule</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Office rent" /></div>
          <div><label className="label">Cadence</label><select className="input" value={cadence} onChange={(e) => setCadence(e.target.value)}><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select></div>
          <div><label className="label">Next run</label><input type="date" className="input" value={nextRun} onChange={(e) => setNextRun(e.target.value)} /></div>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={autoAuth} onChange={(e) => setAutoAuth(e.target.checked)} /> Auto-authorise</label>
          <div className="col-span-2 md:col-span-4"><label className="label">Narration</label><input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} /></div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[11px] font-semibold uppercase tracking-wide text-slate-400"><tr><th className="text-left">Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-left">Remarks</th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2 min-w-[200px]"><AccountPicker accounts={accounts} value={l.account} onChange={(id) => setLine(i, { account: id })} /></td>
                <td className="py-1 px-1"><input className="input text-right tabular-nums" inputMode="decimal" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td>
                <td className="py-1 px-1"><input className="input text-right tabular-nums" inputMode="decimal" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td>
                <td className="py-1 pl-1"><input className="input" value={l.remarks} onChange={(e) => setLine(i, { remarks: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="font-semibold"><td className="py-2 text-right">Total</td><td className="py-2 text-right tabular-nums">{money(totals.d)}</td><td className="py-2 text-right tabular-nums">{money(totals.c)}</td><td className="py-2 pl-2 text-xs">{Math.abs(totals.diff) < 0.005 ? <span className="text-green-600">Balanced ✓</span> : <span className="text-red-600">Diff {money(Math.abs(totals.diff))}</span>}</td></tr></tfoot>
        </table>
        <button onClick={create} disabled={busy || !rights.canCreate} title={rights.denied("create")} className="btn disabled:opacity-40">Save schedule</button>
      </div>
    </div>
  );
}
