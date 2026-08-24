"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

type Acc = { id: string; code: string; name: string; subtype: string };
type Pdc = {
  id: string; direction: string; cheque_no: string | null; bank_name: string | null;
  amount_base: number; cheque_date: string | null; status: string; narration: string | null;
  party: string | null; bank: string | null;
};
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const NEXT: Record<string, string[]> = { in_hand: ["deposited", "cleared", "bounced", "cancelled"], deposited: ["cleared", "bounced"], cleared: [], bounced: [], cancelled: [] };
const BADGE: Record<string, string> = { in_hand: "bg-amber-100 text-amber-700", deposited: "bg-blue-100 text-blue-700", cleared: "bg-green-100 text-green-700", bounced: "bg-red-100 text-red-700", cancelled: "bg-slate-200 text-slate-600" };

export default function PdcClient({ list, partyAccounts, banks }: { list: Pdc[]; partyAccounts: Acc[]; banks: Acc[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [f, setF] = useState({ direction: "received", party: "", bank: "", cheque_no: "", bank_name: "", amount: "", cheque_date: "", narration: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    const { error } = await supabase.rpc("pdc_create", {
      p_company: COMPANY_ID, p_direction: f.direction, p_party_account: f.party || null, p_bank_account: f.bank || null,
      p_cheque_no: f.cheque_no || null, p_bank_name: f.bank_name || null, p_amount: Number(f.amount) || 0,
      p_cheque_date: f.cheque_date || null, p_narration: f.narration || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setF({ ...f, cheque_no: "", amount: "", narration: "" });
    router.refresh();
  }
  async function move(id: string, status: string) {
    if (status === "bounced" && !confirm("Mark bounced? This reverses the receipt and reopens the invoices.")) return;
    const { error } = await supabase.rpc("pdc_update", { p_company: COMPANY_ID, p_pdc: id, p_status: status });
    if (error) return alert(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <form onSubmit={create} className="card grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><label className="label">Direction</label>
          <select className="input" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value, party: "" })}>
            <option value="received">Received (customer)</option><option value="issued">Issued (supplier)</option>
          </select></div>
        <div><label className="label">{f.direction === "received" ? "Customer" : "Supplier"} account</label>
          <select className="input" value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })}>
            <option value="">—</option>
            {partyAccounts.filter((a) => a.subtype === (f.direction === "received" ? "Receivable" : "Payable")).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select></div>
        <div><label className="label">Bank (on clearance)</label>
          <select className="input" value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })}>
            <option value="">—</option>
            {banks.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select></div>
        <div><label className="label">Cheque no</label><input className="input" value={f.cheque_no} onChange={(e) => setF({ ...f, cheque_no: e.target.value })} /></div>
        <div><label className="label">Bank name</label><input className="input" value={f.bank_name} onChange={(e) => setF({ ...f, bank_name: e.target.value })} /></div>
        <div><label className="label">Amount</label><input className="input text-right tabular-nums" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div><label className="label">Cheque date</label><input type="date" className="input" value={f.cheque_date} onChange={(e) => setF({ ...f, cheque_date: e.target.value })} /></div>
        <div className="flex items-end"><button className="btn w-full" disabled={busy}>{busy ? "Saving…" : "Add PDC"}</button></div>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">Dir</th><th className="px-3 py-2 text-left">Cheque</th><th className="px-3 py-2 text-left">Party</th><th className="px-3 py-2 text-left">Maturity</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-center">Status</th><th className="px-3 py-2 text-left">Actions</th></tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5 capitalize">{p.direction}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{p.cheque_no}{p.bank_name ? ` · ${p.bank_name}` : ""}</td>
                <td className="px-3 py-1.5">{p.party ?? "—"}</td>
                <td className="px-3 py-1.5">{p.cheque_date ?? "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(p.amount_base))}</td>
                <td className="px-3 py-1.5 text-center"><span className={`badge ${BADGE[p.status]}`}>{p.status.replace("_", " ")}</span></td>
                <td className="px-3 py-1.5">
                  <div className="flex gap-1">
                    {(NEXT[p.status] ?? []).map((s) => (
                      <button key={s} onClick={() => move(p.id, s)} className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 capitalize">{s}</button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={7}>No cheques.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
