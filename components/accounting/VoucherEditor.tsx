"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
  const source = `gl_${kind}`; // gl_receipt / gl_payment / gl_contra / gl_journal

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

  // Loaded voucher (record-management). null = a new, unsaved voucher.
  const [entryId, setEntryId] = useState<string | null>(null);
  const [entryNo, setEntryNo] = useState<string | null>(null);
  const [editable, setEditable] = useState(true);
  const [gotoNo, setGotoNo] = useState("");
  const [busy, setBusy] = useState(false);

  // Header memory: remember cash/bank per user per kind.
  useEffect(() => {
    try {
      const m = JSON.parse(localStorage.getItem(memKey) || "{}");
      if (m.cash) setCash(m.cash);
    } catch {}
  }, [memKey]);
  useEffect(() => {
    if (!entryId) { try { localStorage.setItem(memKey, JSON.stringify({ cash })); } catch {} }
  }, [memKey, cash, entryId]);

  const isJournal = kind === "journal";
  const isContra = kind === "contra";

  function resetToNew() {
    setEntryId(null); setEntryNo(null); setEditable(true); setDone(null); setError(null);
    setDate(new Date().toISOString().slice(0, 10));
    setNarration(""); setReference(""); setAmount(""); setToAcct(null);
    setLines([emptyLine(), emptyLine()]);
    try { const m = JSON.parse(localStorage.getItem(memKey) || "{}"); setCash(m.cash ?? null); } catch { setCash(null); }
  }

  // Populate the kind-specific fields from a loaded voucher's raw journal lines.
  const loadVoucher = useCallback((v: any) => {
    setError(null); setDone(null);
    setEntryId(v.id); setEntryNo(v.entry_no); setEditable(!!v.editable);
    setDate(v.entry_date); setNarration(v.memo ?? ""); setReference(v.reference ?? "");
    const raw: any[] = v.lines ?? [];
    if (kind === "journal") {
      const ls: Line[] = raw.map((l) => ({ account: l.account_id, debit: Number(l.debit) ? String(Number(l.debit)) : "", credit: Number(l.credit) ? String(Number(l.credit)) : "", amount: "", remarks: l.description ?? "" }));
      setLines(ls.length ? [...ls, emptyLine()] : [emptyLine(), emptyLine()]);
      setCash(null); setToAcct(null); setAmount("");
    } else if (kind === "contra") {
      const from = raw.find((l) => Number(l.debit) > 0); const to = raw.find((l) => Number(l.credit) > 0);
      setCash(from?.account_id ?? null); setToAcct(to?.account_id ?? null);
      setAmount(from ? String(Number(from.debit)) : ""); setLines([emptyLine()]);
    } else {
      // receipt: cash/bank is the debit line, others are credits (amounts).
      // payment: cash/bank is the credit line, others are debits (amounts).
      const bankSide = kind === "receipt" ? "debit" : "credit";
      const lineSide = kind === "receipt" ? "credit" : "debit";
      const bank = raw.find((l) => Number(l[bankSide]) > 0 && raw.filter((x) => Number(x[bankSide]) > 0).length === 1) ?? raw.find((l) => Number(l[bankSide]) > 0);
      setCash(bank?.account_id ?? null);
      const ls: Line[] = raw.filter((l) => l !== bank && Number(l[lineSide]) > 0)
        .map((l) => ({ account: l.account_id, debit: "", credit: "", amount: String(Number(l[lineSide])), remarks: l.description ?? "" }));
      setLines(ls.length ? [...ls, emptyLine()] : [emptyLine(), emptyLine()]);
      setToAcct(null); setAmount("");
    }
  }, [kind]);

  const load = useCallback(async (id: string | null) => {
    if (!id) return;
    setBusy(true); setError(null);
    const { data, error } = await supabase.rpc("gl_voucher_get", { p_entry: id });
    setBusy(false);
    if (error) return setError(error.message);
    if (!data) return setError("Voucher not found.");
    loadVoucher(data);
  }, [supabase, loadVoucher]);

  async function nav(dir: "prev" | "next") {
    setBusy(true); setError(null);
    const { data, error } = await supabase.rpc("gl_voucher_nav", { p_source: source, p_entry: entryId, p_dir: dir });
    setBusy(false);
    if (error) return setError(error.message);
    if (!data) return setError(dir === "prev" ? "This is the first voucher." : "This is the last voucher.");
    await load(data as string);
  }
  async function gotoDoc() {
    if (!gotoNo.trim()) return;
    setBusy(true); setError(null);
    const { data, error } = await supabase.rpc("gl_voucher_find", { p_entry_no: gotoNo.trim(), p_source: source });
    setBusy(false);
    if (error) return setError(error.message);
    if (!data) return setError(`No ${TITLES[kind]} with document no. ${gotoNo.trim()}.`);
    setGotoNo("");
    await load(data as string);
  }
  async function del() {
    if (!entryId) return;
    if (!confirm(`Delete (void) ${TITLES[kind]} ${entryNo ?? ""}? It will be removed from the ledger. This cannot be undone.`)) return;
    const reason = prompt("Reason (optional, recorded in the audit log):", "") ?? "";
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("gl_voucher_void", { p_entry: entryId, p_reason: reason || null });
    setBusy(false);
    if (error) return setError(error.message);
    setDone(`voided ${entryNo ?? ""}`);
    resetToNew(); router.refresh();
  }
  function printVoucher() { if (entryId) window.open(`/accounting/vouchers/${entryId}`, "_blank"); }

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

  // Build journal-style [{account_id, debit, credit, ...}] lines from the current
  // kind-specific fields — used for an in-place edit (gl_voucher_update).
  function buildJournalLines(): any[] {
    if (isJournal) {
      return lines.filter((l) => l.account && (calc(l.debit) || calc(l.credit)))
        .map((l) => ({ account_id: l.account, debit: calc(l.debit) || 0, credit: calc(l.credit) || 0, description: l.remarks || null }));
    }
    if (isContra) {
      const amt = calc(amount);
      return [
        { account_id: cash, debit: amt, credit: 0, description: narration || null },
        { account_id: toAcct, debit: 0, credit: amt, description: narration || null },
      ];
    }
    const total = lines.reduce((s, l) => s + (calc(l.amount) || 0), 0);
    const partyLines = lines.filter((l) => l.account && calc(l.amount)).map((l) => ({
      account_id: l.account,
      debit: kind === "payment" ? (calc(l.amount) || 0) : 0,
      credit: kind === "receipt" ? (calc(l.amount) || 0) : 0,
      description: l.remarks || null,
    }));
    const bank = { account_id: cash, debit: kind === "receipt" ? total : 0, credit: kind === "payment" ? total : 0, description: narration || null };
    return [bank, ...partyLines];
  }

  async function save(printAfter = false) {
    setError(null);
    if (!date) return setError("Date is required");
    try {
      setSaving(true);
      // ---- EDIT an existing voucher (in place) ----
      if (entryId) {
        if (!editable) throw new Error("This voucher can no longer be edited.");
        if (isJournal && Math.abs(totals.diff) > 0.005) throw new Error(`Out of balance by ${money(Math.abs(totals.diff))}`);
        if (!isJournal && !cash) throw new Error(isContra ? "Choose both accounts" : "Choose the cash / bank account");
        if (isContra) {
          const amt = calc(amount);
          if (!toAcct) throw new Error("Choose both accounts");
          if (cash === toAcct) throw new Error("From and To must differ");
          if (!amt || amt <= 0) throw new Error("Enter an amount");
        }
        const jl = buildJournalLines();
        if (jl.filter((l) => l.account_id && (l.debit || l.credit)).length < 2) throw new Error("Enter at least two lines");
        const { data, error } = await supabase.rpc("gl_voucher_update", {
          p_entry: entryId, p_date: date, p_memo: narration || null, p_reference: reference || null, p_lines: jl,
        });
        if (error) throw new Error(error.message);
        setDone(`updated ${(data as any)?.entry_no ?? ""}`);
        router.refresh();
        if (printAfter) printVoucher();
        return;
      }

      // ---- CREATE a new voucher ----
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
      const res = data as any;
      setDone(res?.pending ? `submitted for approval (${money(Number(res.amount))})` : `posted ${res?.entry_no ?? ""}`);
      resetToNew();
      router.refresh();
      if (printAfter && res?.entry_id) window.open(`/accounting/vouchers/${res.entry_id}`, "_blank");
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
  const readOnly = !!entryId && !editable;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{TITLES[kind]}</h1>
        {entryNo
          ? <span className={`rounded-full px-3 py-1 text-sm font-semibold ${readOnly ? "bg-slate-200 text-slate-600" : "bg-blue-100 text-blue-700"}`}>Doc No. {entryNo}{readOnly ? " · locked" : ""}</span>
          : <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-500">New — Doc No. auto</span>}
        {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700 capitalize">{done}</span>}
      </div>

      {/* Record toolbar */}
      <div className="card flex flex-wrap items-center gap-2 py-2">
        <button type="button" onClick={resetToNew} disabled={busy} className="btn-outline text-sm">＋ New</button>
        <button type="button" onClick={() => nav("prev")} disabled={busy} className="btn-outline text-sm">‹ Previous</button>
        <button type="button" onClick={() => nav("next")} disabled={busy} className="btn-outline text-sm">Next ›</button>
        <div className="flex items-center gap-1">
          <input className="input w-32 text-sm" placeholder="Go to Doc No." value={gotoNo}
            onChange={(e) => setGotoNo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") gotoDoc(); }} />
          <button type="button" onClick={gotoDoc} disabled={busy} className="btn-outline text-sm">Load</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={printVoucher} disabled={!entryId} className="btn-outline text-sm disabled:opacity-40">🖨 Print</button>
          <button type="button" onClick={del} disabled={!entryId || !editable || busy} className="btn-outline text-sm text-red-600 disabled:opacity-40">🗑 Delete</button>
        </div>
      </div>

      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {readOnly && <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">This voucher was generated by another module or has allocations — it is read-only here.</div>}

      <div className="card space-y-4">
        {/* Header */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div><label className="label">Date</label>
            <input type="date" className="input" value={date} disabled={readOnly} onChange={(e) => setDate(e.target.value)} /></div>
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
              <input className="input text-right tabular-nums" inputMode="decimal" value={amount} disabled={readOnly} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
          )}
          {!isContra && (
            <div><label className="label">Reference</label>
              <input className="input" value={reference} disabled={readOnly} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / ref no" /></div>
          )}
          <div className={isContra ? "md:col-span-4" : "md:col-span-2"}><label className="label">Narration</label>
            <input className="input" value={narration} disabled={readOnly} onChange={(e) => setNarration(e.target.value)} placeholder="Description" /></div>
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
                      <td className="px-2 py-1"><input className="input text-right tabular-nums" inputMode="decimal" value={l.debit} disabled={readOnly}
                        onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td>
                      <td className="px-2 py-1"><input className="input text-right tabular-nums" inputMode="decimal" value={l.credit} disabled={readOnly}
                        onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td>
                    </> : (
                      <td className="px-2 py-1"><input className="input text-right tabular-nums" inputMode="decimal" value={l.amount} disabled={readOnly}
                        onChange={(e) => setLine(i, { amount: e.target.value })} /></td>
                    )}
                    <td className="px-2 py-1"><input className="input" value={l.remarks} disabled={readOnly} onChange={(e) => setLine(i, { remarks: e.target.value })} /></td>
                    <td className="px-1 text-center">
                      <button type="button" onClick={() => removeLine(i)} disabled={readOnly} className="text-slate-300 hover:text-red-500 disabled:opacity-30" title="Delete line">×</button>
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
          <button onClick={() => save(false)} disabled={saving || readOnly || (isJournal && !balanced)} className="btn">
            {saving ? (entryId ? "Saving…" : "Posting…") : entryId ? "Save changes" : "Save & Post"} <span className="ml-1 opacity-70 text-xs">Ctrl+S</span>
          </button>
          {!isContra && !readOnly && <button type="button" onClick={() => setLines((l) => [...l, emptyLine()])} className="btn-outline text-sm">+ Line</button>}
          <span className="ml-auto text-xs text-slate-400">{entryId ? "Editing an existing voucher — the document number is kept." : "Posts to the ledger immediately — no separate posting step."}</span>
        </div>
      </div>
    </div>
  );
}
