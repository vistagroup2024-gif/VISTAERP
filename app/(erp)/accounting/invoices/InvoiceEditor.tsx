"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import AccountPicker, { type PickAccount } from "@/components/accounting/AccountPicker";

type Party = { id: string; name: string; party_type: string; phone: string | null };
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function InvoiceEditor({ parties, accounts }: { parties: Party[]; accounts: PickAccount[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [kind, setKind] = useState<"customer" | "supplier">("customer");
  const [party, setParty] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [due, setDue] = useState("");
  const [amount, setAmount] = useState("");
  const [taxable, setTaxable] = useState(true);
  const [account, setAccount] = useState<string | null>(null);
  const [narration, setNarration] = useState("");
  const [reference, setReference] = useState("");
  const [override, setOverride] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const amt = Number(amount) || 0;
  const tax = taxable ? +(amt * 0.15).toFixed(2) : 0;
  const total = amt + tax;

  const partyOptions = useMemo(
    () => parties.filter((p) => (kind === "customer" ? p.party_type === "customer" || p.party_type === "b2b_agent" : p.party_type === "supplier")),
    [parties, kind]
  );
  // Suggest revenue accounts for sales, expense/COGS for purchase.
  const lineAccounts = useMemo(
    () => accounts.filter((a) => (kind === "customer" ? a.nature === "income" : a.nature === "expense")),
    [accounts, kind]
  );

  async function save() {
    setErr(null);
    if (!party) return setErr("Choose a party");
    if (!account) return setErr("Choose the income / expense account");
    if (amt <= 0) return setErr("Enter an amount");
    setSaving(true);
    const { data, error } = await supabase.rpc("party_invoice", {
      p_company: COMPANY_ID, p_party: party, p_kind: kind, p_date: date, p_due: due || null,
      p_narration: narration || null, p_amount: amt, p_income_expense_account: account,
      p_tax: tax, p_reference: reference || null, p_override_credit: override,
    });
    setSaving(false);
    if (error) return setErr(error.message);
    setDone(`${(data as any)?.entry_no ?? ""} · total ${money((data as any)?.total ?? total)}`);
    setParty(""); setAmount(""); setNarration(""); setReference(""); setDue("");
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{kind === "customer" ? "Sales Invoice" : "Purchase Bill"}</h1>
        {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">Posted {done}</span>}
      </div>
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="flex gap-2">
        {(["customer", "supplier"] as const).map((k) => (
          <button key={k} onClick={() => { setKind(k); setParty(""); setAccount(null); }}
            className={`rounded-full px-3 py-1 text-sm ${kind === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
            {k === "customer" ? "Sales (customer)" : "Purchase (supplier)"}
          </button>
        ))}
      </div>

      <div className="card space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><label className="label">{kind === "customer" ? "Customer" : "Supplier"}</label>
            <select className="input" value={party} onChange={(e) => setParty(e.target.value)}>
              <option value="">— select —</option>
              {partyOptions.map((p) => <option key={p.id} value={p.id}>{p.name}{p.phone ? ` · ${p.phone}` : ""}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-400">A ledger account is auto-created for this party on first invoice.</p>
          </div>
          <div><label className="label">Date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label">Due date</label><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          <div className="col-span-2"><label className="label">{kind === "customer" ? "Revenue account" : "Expense / COGS account"}</label>
            <AccountPicker accounts={lineAccounts} value={account} onChange={setAccount} placeholder="Account…" /></div>
          <div><label className="label">Amount (before VAT)</label>
            <input className="input text-right tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} /> VAT 15%</label>
            <div className="pb-1 text-sm text-slate-500">Tax {money(tax)} · <b>Total {money(total)}</b></div>
          </div>
          <div><label className="label">Reference</label><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          <div><label className="label">Narration</label><input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} /></div>
        </div>
        {kind === "customer" && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Override credit limit
          </label>
        )}
        <button onClick={save} disabled={saving} className="btn">{saving ? "Posting…" : "Save & Post"}</button>
      </div>
    </div>
  );
}
