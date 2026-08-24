"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import AccountPicker, { type PickAccount } from "./AccountPicker";

export type VoucherKind = "journal" | "receipt" | "payment" | "contra";

type Line = { account: string | null; debit: string; credit: string; amount: string; remarks: string };
const emptyLine = (): Line => ({ account: null, debit: "", credit: "", amount: "", remarks: "" });

// Evaluate a simple arithmetic expression in an amount cell ("1200*3+50"). Returns
// the number, or NaN if it contains anything other than digits and + - * / . ( ).
function calc(v: string): number {
  const s = v.trim();
  if (!s) return 0;
  if (!/^[0-9+\-*/().\s]+$/.test(s)) return NaN;
  try { // eslint-disable-next-line no-new-func
    const n = Function(`"use strict";return (${s})`)();
    return typeof n === "number" && isFinite(n) ? n : NaN;
  } catch { return NaN; }
}
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const TITLES: Record<VoucherKind, string> = { journal: "Journal Entry", receipt: "Receipt", payment: "Payment", contra: "Contra" };

export default function VoucherEditor({ kind, accounts, cashBank }: {
  kind: VoucherKind; accounts: PickAccount[]; cashBank: PickAccount[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const memKey = `voucher:${kind}`;

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [reference, setReference] = useState("");
  const [cash, setCash] = useState<string | null>(null);
  const [toAcct, setToAcct] = useState<string | null>(null); // contra: destination
  const [amount, setAmount] = useState(""); // contra amount
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // Header memory: remember cash/bank per user per kind.
  useEffect(() => {
    try {
      const m = JSON.parse(localStorage.getItem(memKey) || "{}");
      if (m.cash) setCash(m.cash);
    } catch {}
  }, [memKey]);
  useEffect(() => {
    try { localStorage.setItem(memKey, JSON.stringify({ cash })); } catch {}
  }, [memKey, cash]);

  const isJournal = kind === "journal";
  const isContra = kind === "contra";

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => {
      const next = ls.map((l, j) => (j === i ? { ...l, ...patch } : l));
      // auto-append a fresh row when editing the last one
      if (i === next.length - 1 && (patch.account || patch.debit || patch.credit || patch.amount)) next.push(emptyLine());
      return next;
    });
  }
  function removeLine(i: number) { setLines((ls) => (ls.length <= 1 ? ls : ls.filter((_, j) => j !== i))); }

  // Totals + auto-balance amount for the empty trailing journal line.
  const totals = useMemo(() => {
    if (isJournal) {
      let d = 0, c = 0;
      for (const l of lines) { d += calc(l.debit) || 0; c += calc(l.credit) || 0; }
      return { debit: d, credit: c, diff: +(d - c).toFixed(2) };
    }
    let t = 0;
    for (const l of lines) t += calc(l.amount) || 0;
    return { debit: t, credit: t, diff: 0 };
  }, [lines, isJournal]);

  async function save(printAfter = false) {
    setError(null);
    if (!date) return setError("Date is required");
    try {
      setSaving(true);
      let rpc: string; let args: any;
      if (isJournal) {
        if (Math.abs(totals.diff) > 0.005) throw new Error(`Out of balance by ${money(Math.abs(totals.diff))}`);
        const payload = lines
          .filter((l) => l.account && (calc(l.debit) || calc(l.credit)))
          .map((l) => ({ account: l.account, debit: calc(l.debit) || 0, credit: calc(l.credit) || 0, remarks: l.remarks || null }));
        if (payload.length < 2) throw new Error("Enter at least two lines");
        rpc = "gl_journal";
        args = { p_company: COMPANY_ID, p_date: date, p_narration: narration || null, p_reference: reference || null, p_lines: payload };
      } else if (isContra) {
        const amt = calc(amount);
        if (!cash || !toAcct) throw new Error("Choose both accounts");
        if (cash === toAcct) throw new Error("From and To must differ");
        if (!amt || amt <= 0) throw new Error("Enter an amount");
        rpc = "gl_contra";
        args = { p_company: COMPANY_ID, p_date: date, p_from: cash, p_to: toAcct, p_amount: amt, p_narration: narration || null };
      } else {
        if (!cash) throw new Error(`Choose the cash / bank account`);
        const payload = lines.filter((l) => l.account && calc(l.amount))
          .map((l) => ({ account: l.account, amount: calc(l.amount) || 0, remarks: l.remarks || null }));
        if (payload.length < 1) throw new Error("Enter at least one line");
        rpc = kind === "receipt" ? "gl_receipt" : "gl_payment";
        args = { p_company: COMPANY_ID, p_date: date, p_cash_bank: cash, p_narration: narration || null, p_reference: reference || null, p_lines: payload };
      }
      const { data, error } = await supabase.rpc(rpc, args);
      if (error) throw new Error(error.message);
      const no = (data as any)?.entry_no ?? "";
      setDone(no);
      // reset for next entry (keep date + cash/bank)
      setNarration(""); setReference(""); setAmount(""); setToAcct(null); setLines([emptyLine(), emptyLine()]);
      router.refresh();
      if (printAfter && (data as any)?.entry_id) window.open(`/accounting/vouchers/${(data as any).entry_id}`, "_blank");
    } catch (e: any) {
      setError(e.message);
    } finally { setSaving(false); }
  }

  // Ctrl+S to save.
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveRef.current(false); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const balanced = isJournal ? Math.abs(totals.diff) < 0.005 : true;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{TITLES[kind]}</h1>
        {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">Posted {done}</span>}
      </div>
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="card space-y-4">
        {/* Header */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div><label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          {!isJournal && (
            <div className="md:col-span-1"><label className="label">{isContra ? "From (cash/bank)" : "Cash / Bank"}</label>
              <AccountPicker accounts={cashBank} value={cash} onChange={setCash} placeholder="Cash / bank…" /></div>
          )}
          {isContra && (
            <div><label className="label">To (cash/bank)</label>
              <AccountPicker accounts={cashBank} value={toAcct} onChange={setToAcct} placeholder="Destination…" /></div>
          )}
          {isContra && (
            <div><label className="label">Amount</label>
              <input className="input text-right tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
          )}
          {!isContra && (
            <div><label className="label">Reference</label>
              <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / ref no" /></div>
          )}
          <div className={isContra ? "md:col-span-4" : "md:col-span-2"}><label className="label">Narration</label>
            <input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Description" /></div>
        </div>

        {/* Lines (not for contra) */}
        {!isContra && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Account</th>
                  {isJournal ? <>
                    <th className="px-2 py-2 text-right">Debit</th>
                    <th className="px-2 py-2 text-right">Credit</th>
                  </> : <th className="px-2 py-2 text-right">Amount</th>}
                  <th className="px-2 py-2 text-left">Remarks</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                    <td className="px-2 py-1 min-w-[220px]">
                      <AccountPicker accounts={accounts} value={l.account} onChange={(id) => setLine(i, { account: id })} />
                    </td>
                    {isJournal ? <>
                      <td className="px-2 py-1"><input className="input text-right tabular-nums" inputMode="decimal" value={l.debit}
                        onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td>
                      <td className="px-2 py-1"><input className="input text-right tabular-nums" inputMode="decimal" value={l.credit}
                        onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td>
                    </> : (
                      <td className="px-2 py-1"><input className="input text-right tabular-nums" inputMode="decimal" value={l.amount}
                        onChange={(e) => setLine(i, { amount: e.target.value })} /></td>
                    )}
                    <td className="px-2 py-1"><input className="input" value={l.remarks} onChange={(e) => setLine(i, { remarks: e.target.value })} /></td>
                    <td className="px-1 text-center">
                      <button type="button" onClick={() => removeLine(i)} className="text-slate-300 hover:text-red-500" title="Delete line">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <td /><td className="px-2 py-2 text-right text-slate-500">Total</td>
                  {isJournal ? <>
                    <td className="px-2 py-2 text-right tabular-nums">{money(totals.debit)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(totals.credit)}</td>
                  </> : <td className="px-2 py-2 text-right tabular-nums">{money(totals.debit)}</td>}
                  <td className="px-2 py-2 text-xs">
                    {isJournal && (balanced
                      ? <span className="text-green-600">Balanced ✓</span>
                      : <span className="text-red-600">Diff {money(Math.abs(totals.diff))} {totals.diff > 0 ? "Dr" : "Cr"}</span>)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button onClick={() => save(false)} disabled={saving || (isJournal && !balanced)} className="btn">
            {saving ? "Posting…" : "Save & Post"} <span className="ml-1 opacity-70 text-xs">Ctrl+S</span>
          </button>
          {!isContra && <button type="button" onClick={() => setLines((l) => [...l, emptyLine()])} className="btn-outline text-sm">+ Line</button>}
          <span className="ml-auto text-xs text-slate-400">Posts to the ledger immediately — no separate posting step.</span>
        </div>
      </div>
    </div>
  );
}
