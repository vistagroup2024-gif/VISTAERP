"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

type Acc = { id: string; code: string; name: string; subtype: string };
type Line = { id: string; line_date: string | null; description: string | null; ref: string | null; amount: number; status: string };
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

// Parse pasted CSV: date,description,amount  (amount signed: + deposit, - withdrawal).
function parseCsv(text: string) {
  return text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean).map((r) => {
    const p = r.split(",");
    return { date: (p[0] || "").trim(), description: (p[1] || "").trim(), ref: (p[3] || "").trim(), amount: Number((p[2] || "0").replace(/[^0-9.\-]/g, "")) || 0 };
  }).filter((x) => x.amount !== 0);
}

export default function BankClient({ banks, contras, statement, lines }: { banks: Acc[]; contras: Acc[]; statement: any; lines: Line[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [bank, setBank] = useState(statement?.bank_account_id ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [csv, setCsv] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function importStmt() {
    setErr(null); const rows = parseCsv(csv);
    if (!bank) return setErr("Choose the bank account");
    if (rows.length === 0) return setErr("Paste statement rows: date,description,amount (signed)");
    setBusy(true);
    const { data, error } = await supabase.rpc("bank_import", { p_company: COMPANY_ID, p_bank_account: bank, p_statement_date: date, p_note: null, p_lines: rows });
    setBusy(false);
    if (error) return setErr(error.message);
    router.push(`/accounting/bank?statement=${(data as any).statement_id}`);
  }
  async function autoMatch() {
    setBusy(true); const { data, error } = await supabase.rpc("bank_automatch", { p_company: COMPANY_ID, p_statement: statement.id });
    setBusy(false); if (error) return setErr(error.message); setMsg(`Auto-matched ${(data as any).matched} line(s).`); router.refresh();
  }
  async function unmatch(id: string) { await supabase.rpc("bank_unmatch", { p_company: COMPANY_ID, p_line: id }); router.refresh(); }
  async function createEntry(id: string, contra: string) {
    if (!contra) return; const { error } = await supabase.rpc("bank_create_entry", { p_company: COMPANY_ID, p_line: id, p_contra: contra });
    if (error) return alert(error.message); router.refresh();
  }

  const matched = lines.filter((l) => l.status === "matched");
  const unmatched = lines.filter((l) => l.status !== "matched");
  const stmtTotal = lines.reduce((s, l) => s + Number(l.amount), 0);
  const matchedTotal = matched.reduce((s, l) => s + Number(l.amount), 0);

  return (
    <div className="space-y-4">
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {msg && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}

      {!statement && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Import statement</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div><label className="label">Bank account</label>
              <select className="input" value={bank} onChange={(e) => setBank(e.target.value)}>
                <option value="">—</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select></div>
            <div><label className="label">Statement date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div><label className="label">Rows (CSV: <code>date,description,amount,ref</code> — amount signed, + deposit / − withdrawal)</label>
            <textarea className="input font-mono text-xs" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"2026-08-01,Customer deposit,5000\n2026-08-03,Bank charges,-25"} /></div>
          <button onClick={importStmt} disabled={busy} className="btn">Import</button>
        </div>
      )}

      {statement && (
        <>
          <div className="card flex flex-wrap items-center gap-4">
            <div><div className="text-xs text-slate-400">Statement total</div><div className="text-lg font-bold tabular-nums">{money(stmtTotal)}</div></div>
            <div><div className="text-xs text-slate-400">Matched</div><div className="text-lg font-bold tabular-nums text-green-700">{money(matchedTotal)}</div></div>
            <div><div className="text-xs text-slate-400">Unmatched</div><div className="text-lg font-bold tabular-nums text-red-600">{money(stmtTotal - matchedTotal)} · {unmatched.length} line(s)</div></div>
            <button onClick={autoMatch} disabled={busy} className="btn ml-auto">Auto-match</button>
          </div>

          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Description</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-center">Status</th><th className="px-3 py-2 text-left">Action</th></tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">{l.line_date ?? "—"}</td>
                    <td className="px-3 py-1.5">{l.description}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${l.amount < 0 ? "text-red-600" : ""}`}>{money(l.amount)}</td>
                    <td className="px-3 py-1.5 text-center"><span className={`badge ${l.status === "matched" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{l.status}</span></td>
                    <td className="px-3 py-1.5">
                      {l.status === "matched"
                        ? <button onClick={() => unmatch(l.id)} className="text-xs text-slate-500 hover:underline">Unmatch</button>
                        : <select className="input h-8 py-0 text-xs" defaultValue="" onChange={(e) => createEntry(l.id, e.target.value)}>
                            <option value="">Create entry → contra…</option>
                            {contras.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                          </select>}
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={5}>No lines.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
