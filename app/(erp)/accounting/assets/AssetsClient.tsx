"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { useDocRights } from "@/components/AccessProvider";

type Acc = { id: string; code: string; name: string };
type FA = { id: string; name: string; cost: number; salvage: number; purchase_date: string; life_months: number; accumulated: number; depreciated_to: string | null; status: string };
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

export default function AssetsClient({ assets, assetAccounts }: { assets: FA[]; assetAccounts: Acc[] }) {
  const rights = useDocRights("fixed_assets");
  const router = useRouter();
  const supabase = createClient();
  const [f, setF] = useState({ name: "", asset_account_id: "", cost: "", salvage: "0", purchase_date: new Date().toISOString().slice(0, 10), life_months: "60" });
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    const { error } = await supabase.from("fixed_assets").insert({
      company_id: COMPANY_ID, name: f.name, asset_account_id: f.asset_account_id || null,
      cost: Number(f.cost) || 0, salvage: Number(f.salvage) || 0, purchase_date: f.purchase_date, life_months: Number(f.life_months) || 60,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setF({ ...f, name: "", cost: "" }); router.refresh();
  }
  async function runDep() {
    setErr(null); setMsg(null); setBusy(true);
    const { data, error } = await supabase.rpc("depreciation_run", { p_company: COMPANY_ID, p_period: period });
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg(`Depreciated ${(data as any).assets} asset(s) · SAR ${money((data as any).total)} for ${period}`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {msg && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}

      <form onSubmit={add} className="card grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="col-span-2"><label className="label">Asset name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
        <div className="col-span-2"><label className="label">Asset account</label>
          <select className="input" value={f.asset_account_id} onChange={(e) => setF({ ...f, asset_account_id: e.target.value })}>
            <option value="">—</option>{assetAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></div>
        <div><label className="label">Cost</label><input className="input text-right tabular-nums" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} required /></div>
        <div><label className="label">Salvage</label><input className="input text-right tabular-nums" inputMode="decimal" value={f.salvage} onChange={(e) => setF({ ...f, salvage: e.target.value })} /></div>
        <div><label className="label">Purchase date</label><input type="date" className="input" value={f.purchase_date} onChange={(e) => setF({ ...f, purchase_date: e.target.value })} /></div>
        <div><label className="label">Life (months)</label><input type="number" className="input" value={f.life_months} onChange={(e) => setF({ ...f, life_months: e.target.value })} /></div>
        <div className="flex items-end"><button className="btn w-full disabled:opacity-40" disabled={busy || !rights.canCreate} title={rights.denied("create")}>{!rights.canCreate ? "No Create rights" : "Add asset"}</button></div>
      </form>

      <div className="card flex flex-wrap items-end gap-3">
        <div><label className="label">Depreciation for month-end</label><input type="date" className="input" value={period} onChange={(e) => setPeriod(e.target.value)} /></div>
        <button onClick={runDep} disabled={busy || !rights.canEdit} title={rights.denied("edit")} className="btn disabled:opacity-40">Run depreciation</button>
        <span className="text-xs text-slate-400">Posts one month of straight-line depreciation (Dr Depreciation, Cr Accumulated Depreciation) for each asset not yet depreciated for that month.</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">Asset</th><th className="px-3 py-2 text-left">Purchased</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Accum. Dep</th><th className="px-3 py-2 text-right">Net book</th><th className="px-3 py-2 text-left">Dep. to</th></tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5">{a.name}</td>
                <td className="px-3 py-1.5">{a.purchase_date}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(a.cost)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(a.accumulated)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-medium">{money(Number(a.cost) - Number(a.accumulated))}</td>
                <td className="px-3 py-1.5">{a.depreciated_to ?? "—"}</td>
              </tr>
            ))}
            {assets.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={6}>No assets.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
