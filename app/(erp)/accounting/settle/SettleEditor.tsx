"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import AccountPicker, { type PickAccount } from "@/components/accounting/AccountPicker";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function SettleEditor({ partyAccounts, cashBank }: { partyAccounts: PickAccount[]; cashBank: PickAccount[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [kind, setKind] = useState<"customer" | "supplier">("customer");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cash, setCash] = useState<string | null>(null);
  const [party, setParty] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const [reference, setReference] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const options = useMemo(
    () => partyAccounts.filter((a) => (kind === "customer" ? a.subtype === "Receivable" : a.subtype === "Payable")),
    [partyAccounts, kind]
  );

  useEffect(() => {
    if (!party) { setItems([]); return; }
    supabase.rpc("party_outstanding", { p_company: COMPANY_ID, p_account_id: party })
      .then(({ data }) => setItems((data ?? []) as any[]));
  }, [party, supabase]);

  const totalOut = items.reduce((s, i) => s + Number(i.outstanding), 0);
  const amt = Number(amount) || 0;

  // FIFO preview: how the amount would land on the oldest items.
  const preview = useMemo(() => {
    let rem = amt; return items.map((i) => {
      const take = Math.min(rem, Number(i.outstanding)); rem = +(rem - take).toFixed(2);
      return { ...i, take };
    });
  }, [items, amt]);

  async function save() {
    setErr(null);
    if (!cash) return setErr("Choose cash / bank");
    if (!party) return setErr("Choose the party account");
    if (amt <= 0) return setErr("Enter an amount");
    setSaving(true);
    const { data, error } = await supabase.rpc("party_settle", {
      p_company: COMPANY_ID, p_kind: kind, p_date: date, p_cash_bank: cash, p_party_account: party,
      p_amount: amt, p_narration: narration || null, p_reference: reference || null,
    });
    setSaving(false);
    if (error) return setErr(error.message);
    const r = data as any;
    setDone(`${r.entry_no} · allocated ${money(r.allocated)}${r.on_account > 0 ? ` · on-account ${money(r.on_account)}` : ""}`);
    setAmount(""); setNarration(""); setReference("");
    supabase.rpc("party_outstanding", { p_company: COMPANY_ID, p_account_id: party }).then(({ data }) => setItems((data ?? []) as any[]));
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{kind === "customer" ? "Receive from Customer" : "Pay Supplier"}</h1>
        {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">{done}</span>}
      </div>
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="flex gap-2">
        {(["customer", "supplier"] as const).map((k) => (
          <button key={k} onClick={() => { setKind(k); setParty(null); }}
            className={`rounded-full px-3 py-1 text-sm ${kind === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
            {k === "customer" ? "Receive" : "Pay"}
          </button>
        ))}
      </div>

      <div className="card space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">Date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label">Cash / Bank</label><AccountPicker accounts={cashBank} value={cash} onChange={setCash} placeholder="Cash / bank…" /></div>
          <div className="col-span-2"><label className="label">{kind === "customer" ? "Customer account" : "Supplier account"}</label>
            <select className="input" value={party ?? ""} onChange={(e) => setParty(e.target.value || null)}>
              <option value="">— select —</option>
              {options.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select></div>
          <div><label className="label">Amount</label>
            <input className="input text-right tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
          <div><label className="label">Reference</label><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          <div className="col-span-2"><label className="label">Narration</label><input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} /></div>
        </div>

        {party && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className="font-semibold text-slate-600">Outstanding items (FIFO)</span>
              <span className="tabular-nums">Total {money(totalOut)}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <tr><th className="px-3 py-1.5 text-left">Doc</th><th className="px-3 py-1.5 text-left">Date</th><th className="px-3 py-1.5 text-right">Outstanding</th><th className="px-3 py-1.5 text-right">Will apply</th></tr>
              </thead>
              <tbody>
                {preview.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-mono text-xs">{i.doc_no}</td>
                    <td className="px-3 py-1.5">{i.doc_date}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(i.outstanding))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-brand">{i.take > 0 ? money(i.take) : ""}</td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td className="px-3 py-3 text-center text-slate-400" colSpan={4}>No outstanding items — amount will sit on-account.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <button onClick={save} disabled={saving} className="btn">{saving ? "Posting…" : "Save & Post"}</button>
      </div>
    </div>
  );
}
