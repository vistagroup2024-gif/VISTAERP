"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, money } from "@/lib/format";

type Line = { account_id: string; description: string; debit: number; credit: number };
const blank: Line = { account_id: "", description: "", debit: 0, credit: 0 };

export default function NewJournalEntry() {
  const router = useRouter();
  const supabase = createClient();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...blank }, { ...blank }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("accounts").select("id, code, name").order("code").then(({ data }) => setAccounts(data ?? []));
  }, [supabase]);

  function update(i: number, patch: Partial<Line>) {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const totalDr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = totalDr === totalCr && totalDr > 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!balanced) return setError("Debits must equal credits and be greater than zero.");
    setSaving(true);
    setError(null);

    const { data: no, error: nErr } = await supabase.rpc("next_doc_number", { p_company: COMPANY_ID, p_doc_type: "journal" });
    if (nErr) { setSaving(false); return setError(nErr.message); }

    const { data: entry, error: eErr } = await supabase
      .from("journal_entries")
      .insert({ company_id: COMPANY_ID, entry_no: no, entry_date: date, memo, status: "posted", source: "manual" })
      .select("id")
      .single();
    if (eErr || !entry) { setSaving(false); return setError(eErr?.message ?? "Failed"); }

    const { error: lErr } = await supabase.from("journal_lines").insert(
      lines.filter((l) => l.account_id && (l.debit || l.credit)).map((l) => ({
        entry_id: entry.id,
        account_id: l.account_id,
        description: l.description || null,
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
      }))
    );
    if (lErr) { setSaving(false); return setError(lErr.message); }

    router.push(`/accounting/journal/${entry.id}`);
    router.refresh();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold">Manual Journal Entry</h1>
      <form onSubmit={save} className="space-y-4">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="card grid grid-cols-2 gap-4">
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label className="label">Memo</label>
            <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Description" />
          </div>
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Lines (amounts in PKR)</h2>
            <button type="button" className="btn-outline" onClick={() => setLines([...lines, { ...blank }])}>+ Add line</button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <select className="input col-span-5" value={l.account_id} onChange={(e) => update(i, { account_id: e.target.value })}>
                  <option value="">Select account…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
                <input className="input col-span-3" placeholder="Description" value={l.description} onChange={(e) => update(i, { description: e.target.value })} />
                <input className="input col-span-2" type="number" step="0.01" placeholder="Debit" value={l.debit || ""} onChange={(e) => update(i, { debit: Number(e.target.value), credit: 0 })} />
                <input className="input col-span-2" type="number" step="0.01" placeholder="Credit" value={l.credit || ""} onChange={(e) => update(i, { credit: Number(e.target.value), debit: 0 })} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-6 text-sm">
            <span>Debits: <b>{money(totalDr, "PKR")}</b></span>
            <span>Credits: <b>{money(totalCr, "PKR")}</b></span>
            <span className={balanced ? "text-green-600" : "text-red-600"}>{balanced ? "Balanced ✓" : "Out of balance"}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button className="btn" disabled={saving || !balanced}>{saving ? "Posting…" : "Post entry"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
