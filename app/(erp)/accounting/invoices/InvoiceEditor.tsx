"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import AccountPicker, { type PickAccount } from "@/components/accounting/AccountPicker";
import FormSection, { Field } from "@/components/ui/FormSection";
import { useDocRights } from "@/components/AccessProvider";

type Party = { id: string; name: string; party_type: string; phone: string | null };
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

type Named = { id: string; name: string };
export default function InvoiceEditor({ parties, accounts, costCenters = [], salespersons = [] }: {
  parties: Party[]; accounts: PickAccount[]; costCenters?: Named[]; salespersons?: Named[];
}) {
  const rights = useDocRights("invoice_bill");
  const router = useRouter();
  const supabase = createClient();
  const [kind, setKind] = useState<"customer" | "supplier">("customer");
  const [party, setParty] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const [salesperson, setSalesperson] = useState("");
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
    const { data, error } = await supabase.rpc("invoice_bill_save", {
      p_company: COMPANY_ID, p_party: party, p_kind: kind, p_date: date, p_due: due || null,
      p_narration: narration || null, p_amount: amt, p_income_expense_account: account,
      p_tax: tax, p_reference: reference || null, p_override_credit: override,
      p_cost_center: costCenter || null, p_salesperson: (kind === "customer" && salesperson) ? salesperson : null,
    });
    setSaving(false);
    if (error) return setErr(error.message);
    const comm = Number((data as any)?.commission) || 0;
    setDone(`${(data as any)?.entry_no ?? ""} · total ${money((data as any)?.total ?? total)}${comm > 0 ? ` · commission ${money(comm)}` : ""}`);
    setParty(""); setAmount(""); setNarration(""); setReference(""); setDue("");
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{kind === "customer" ? "Sales Invoice" : "Purchase Bill"}</h1>
        {done && <span className="badge badge-success">Posted · {done}</span>}
      </div>
      {err && <div className="rounded-md border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      {/* Segmented Sales / Purchase toggle */}
      <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5">
        {(["customer", "supplier"] as const).map((k) => (
          <button key={k} onClick={() => { setKind(k); setParty(""); setAccount(null); }}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${kind === k ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {k === "customer" ? "Sales (customer)" : "Purchase (supplier)"}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="card space-y-6">
        <FormSection title="Party & Dates">
          <Field label={kind === "customer" ? "Customer" : "Supplier"} required full hint="A ledger account is auto-created for this party on first invoice.">
            <select className="input" value={party} onChange={(e) => setParty(e.target.value)}>
              <option value="">— select —</option>
              {partyOptions.map((p) => <option key={p.id} value={p.id}>{p.name}{p.phone ? ` · ${p.phone}` : ""}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Due date"><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </FormSection>

        <FormSection title="Amount">
          <Field label={kind === "customer" ? "Revenue account" : "Expense / COGS account"} required full>
            <AccountPicker accounts={lineAccounts} value={account} onChange={setAccount} placeholder="Account…" />
          </Field>
          <Field label="Amount (before VAT)" required>
            <input className="input text-right tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="VAT & total">
            <div className="flex h-[38px] items-center gap-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} /> VAT 15%</label>
              <span className="text-sm text-slate-500">Tax {money(tax)} · <b className="text-slate-800">Total {money(total)}</b></span>
            </div>
          </Field>
        </FormSection>

        <FormSection title="Classification & Notes">
          <Field label="Reference"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          <Field label="Narration"><input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
          <Field label="Cost Center">
            <select className="input" value={costCenter} onChange={(e) => setCostCenter(e.target.value)}>
              <option value="">—</option>{costCenters.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </Field>
          {kind === "customer" && (
            <Field label="Salesperson" hint="Commission auto-posts if a rule exists for this salesperson + cost center.">
              <select className="input" value={salesperson} onChange={(e) => setSalesperson(e.target.value)}>
                <option value="">— none —</option>{salespersons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          {kind === "customer" && (
            <Field label="Options" full>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Override credit limit
              </label>
            </Field>
          )}
        </FormSection>

        <div className="border-t border-slate-100 pt-4">
          <button type="submit" disabled={saving || !rights.canCreate} title={rights.denied("create")} className="btn disabled:opacity-40">{!rights.canCreate ? "No Create rights" : saving ? "Posting…" : "Save & Post"}</button>
        </div>
      </form>
    </div>
  );
}
