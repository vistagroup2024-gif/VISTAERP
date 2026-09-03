"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { DocRight } from "@/lib/docRights";
import { COMPANY_ID } from "@/lib/format";
import AccountPicker, { type PickAccount } from "./AccountPicker";

export type VoucherKind = "journal" | "receipt" | "payment" | "contra";

type Alloc = { open_item_id: string; amount: number };
type Line = { account: string | null; debit: string; credit: string; amount: string; remarks: string; alloc?: Alloc[] };
const emptyLine = (): Line => ({ account: null, debit: "", credit: "", amount: "", remarks: "" });
type Bill = { id: string; doc_no: string | null; doc_date: string | null; due_date: string | null; amount: number; outstanding: number };

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

// An optional preset that turns the Payment voucher into a distinct payment-style
// voucher (Petty Cash, Commission …). Purely additive — when absent the editor
// behaves exactly as before. `source` gives the voucher its own document series
// and register; `postRpc` is the SECURITY DEFINER function used to post it.
export type VoucherVariant = {
  source: string; title: string; postRpc: string;
  cashLabel?: string; cashMatch?: string; lineLabel?: string;
};

export default function VoucherEditor({ kind, accounts, cashBank, variant, rights }: {
  kind: VoucherKind; accounts: PickAccount[]; cashBank: PickAccount[]; variant?: VoucherVariant;
  rights?: Partial<Record<DocRight, boolean>>;
}) {
  // Rights come resolved from the server page. Absent = unrestricted, which is
  // what an admin or a user with no Access rights configured gets.
  const may = (r: DocRight) => (rights ? !!rights[r] : true);
  const router = useRouter();
  const supabase = createClient();
  const memKey = `voucher:${variant?.source ?? kind}`;
  const source = variant?.source ?? `gl_${kind}`; // gl_receipt / gl_payment / gl_contra / gl_journal / gl_petty …
  const title = variant?.title ?? TITLES[kind];
  // For a variant, offer only the matching cash/bank accounts (e.g. Petty Cash).
  const payAccounts = useMemo(
    () => (variant?.cashMatch ? cashBank.filter((a) => a.name.toUpperCase().includes(variant.cashMatch!.toUpperCase())) : cashBank),
    [cashBank, variant?.cashMatch]);

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
  const [docField, setDocField] = useState(""); // header Document No. box (also used to load by number)
  const [busy, setBusy] = useState(false);

  // Bill-wise adjustment modal state.
  const [adjustFor, setAdjustFor] = useState<number | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [allocInput, setAllocInput] = useState<Record<string, string>>({});
  const [billErr, setBillErr] = useState<string | null>(null);

  // Masters: Cost Center + Tag Area (loaded once). Applied to the voucher's lines.
  const [costCenters, setCostCenters] = useState<{ id: string; name: string }[]>([]);
  const [tagAreas, setTagAreas] = useState<{ id: string; name: string }[]>([]);
  const [costCenter, setCostCenter] = useState("");
  const [tagArea, setTagArea] = useState("");
  // Multi-currency (Journal only): foreign amounts × rate → base (SAR) for the GL.
  const [currencies, setCurrencies] = useState<{ code: string; rate_to_base: number }[]>([]);
  const [currency, setCurrency] = useState("SAR");
  const [fxRate, setFxRate] = useState("");
  useEffect(() => {
    (async () => {
      const [{ data: cc }, { data: ta }, { data: cu }] = await Promise.all([
        supabase.from("acct_cost_centers").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
        supabase.from("acct_tag_areas").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
        supabase.from("currencies").select("code, rate_to_base").eq("is_active", true).order("code"),
      ]);
      setCostCenters((cc as any[]) ?? []); setTagAreas((ta as any[]) ?? []); setCurrencies((cu as any[]) ?? []);
    })();
  }, [supabase]);
  function pickCurrency(code: string) {
    setCurrency(code);
    const c = currencies.find((x) => x.code === code);
    setFxRate(code === "SAR" ? "" : (c ? String(Number(c.rate_to_base)) : ""));
  }
  const dims = () => ({ cost_center: costCenter || null, tag_area: tagArea || null });

  // Bill-wise adjustment is available on Receipt, Payment and Journal (party lines).
  const canBillwise = !variant && (kind === "receipt" || kind === "payment" || kind === "journal");
  // The allocatable amount of a line: the amount cell (receipt/payment) or the
  // debit/credit (journal).
  const lineAmt = (l: Line) => (kind === "journal" ? (calc(l.debit) || calc(l.credit) || 0) : (calc(l.amount) || 0));

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
    setEntryId(null); setEntryNo(null); setEditable(true); setDone(null); setError(null); setDocField("");
    setDate(new Date().toISOString().slice(0, 10));
    setNarration(""); setReference(""); setAmount(""); setToAcct(null); setCostCenter(""); setTagArea("");
    setLines([emptyLine(), emptyLine()]);
    try { const m = JSON.parse(localStorage.getItem(memKey) || "{}"); setCash(m.cash ?? null); } catch { setCash(null); }
  }

  // Populate the kind-specific fields from a loaded voucher's raw journal lines.
  const loadVoucher = useCallback((v: any) => {
    setError(null); setDone(null);
    setEntryId(v.id); setEntryNo(v.entry_no); setEditable(!!v.editable); setDocField(v.entry_no ?? "");
    setDate(v.entry_date); setNarration(v.memo ?? ""); setReference(v.reference ?? "");
    const raw: any[] = v.lines ?? [];
    setCostCenter(raw.find((l) => l.cost_center)?.cost_center ?? ""); setTagArea(raw.find((l) => l.tag_area)?.tag_area ?? "");
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
  async function loadByDoc() {
    const no = docField.trim();
    if (!no) return;
    if (no === entryNo) return; // already showing it
    setBusy(true); setError(null);
    const { data, error } = await supabase.rpc("gl_voucher_find", { p_entry_no: no, p_source: source });
    setBusy(false);
    if (error) return setError(error.message);
    if (!data) return setError(`No ${title} with document no. ${no}.`);
    await load(data as string);
  }

  // ----- Bill-wise adjustment -----
  async function fetchBills(acct: string): Promise<Bill[]> {
    const { data, error } = await supabase.rpc("party_outstanding", { p_company: COMPANY_ID, p_account_id: acct });
    if (error) { setError(error.message); return []; }
    return (data as Bill[]) ?? [];
  }
  function openWith(i: number, bl: Bill[]) {
    setBills(bl);
    const seed: Record<string, string> = {};
    (lines[i].alloc ?? []).forEach((a) => { seed[a.open_item_id] = String(a.amount); });
    setAllocInput(seed);
    setBillErr(null); setAdjustFor(i);
  }
  async function openAdjust(i: number) {
    const acct = lines[i].account;
    if (!acct) { setError("Choose the account on this line first."); return; }
    setBusy(true); const bl = await fetchBills(acct); setBusy(false);
    openWith(i, bl);
  }
  // Auto-open the bill-wise popup when an amount is entered on a party line that
  // actually has outstanding bills — so no manual button press is needed.
  const autoRef = useRef<string>("");
  async function maybeAutoAdjust(i: number) {
    if (!canBillwise || readOnly || entryId) return;
    const l = lines[i]; if (!l?.account) return;
    if ((l.alloc?.length ?? 0) > 0) return;      // already allocated — don't nag
    if (lineAmt(l) <= 0) return;
    const key = `${i}:${l.account}:${lineAmt(l)}`;
    if (autoRef.current === key) return;         // don't re-open for the same value
    autoRef.current = key;
    const bl = await fetchBills(l.account);
    if (bl.length > 0) openWith(i, bl);          // silent when the account has no bills
  }
  const adjTarget = adjustFor != null && lines[adjustFor] ? lineAmt(lines[adjustFor]) : 0;
  const adjDone = Object.values(allocInput).reduce((s, v) => s + (Number(v) || 0), 0);
  function fillFifo() {
    let remaining = adjTarget; const next: Record<string, string> = {};
    for (const b of bills) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(b.outstanding) || 0);
      if (take > 0) { next[b.id] = String(+take.toFixed(2)); remaining -= take; }
    }
    setAllocInput(next);
  }
  function saveAdjust() {
    if (adjustFor == null) return;
    if (adjDone - adjTarget > 0.005) { setBillErr(`Adjusted ${money(adjDone)} exceeds the amount ${money(adjTarget)}.`); return; }
    const alloc: Alloc[] = bills
      .map((b) => ({ open_item_id: b.id, amount: +(Number(allocInput[b.id]) || 0).toFixed(2) }))
      .filter((a) => a.amount > 0);
    setLines((ls) => ls.map((l, j) => (j === adjustFor ? { ...l, alloc: alloc.length ? alloc : undefined } : l)));
    setAdjustFor(null); setBills([]); setAllocInput({}); setBillErr(null);
  }
  async function del() {
    if (!may("delete")) return;
    if (!entryId) return;
    if (!confirm(`Delete (void) ${title} ${entryNo ?? ""}? It will be removed from the ledger. This cannot be undone.`)) return;
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
        .map((l) => ({ account_id: l.account, debit: calc(l.debit) || 0, credit: calc(l.credit) || 0, description: l.remarks || null, ...dims() }));
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
    if (!(entryId ? may("edit") : may("create"))) return;
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
        const rows = lines.filter((l) => l.account && (calc(l.debit) || calc(l.credit)));
        if (rows.length < 2) throw new Error("Enter at least two lines");
        const hasAlloc = rows.some((l) => (l.alloc?.length ?? 0) > 0);
        if (hasAlloc) {
          const payload = rows.map((l) => ({
            account: l.account, debit: calc(l.debit) || 0, credit: calc(l.credit) || 0, remarks: l.remarks || null, ...dims(),
            allocations: (l.alloc ?? []).map((a) => ({ open_item_id: a.open_item_id, amount: a.amount })),
          }));
          const { data, error } = await supabase.rpc("gl_journal_billwise", {
            p_company: COMPANY_ID, p_date: date, p_narration: narration || null, p_reference: reference || null, p_lines: payload,
          });
          if (error) throw new Error(error.message);
          setDone(`posted ${(data as any)?.entry_no ?? ""} (bill-wise)`);
          resetToNew(); router.refresh();
          if (printAfter && (data as any)?.entry_id) window.open(`/accounting/vouchers/${(data as any).entry_id}`, "_blank");
          return;
        }
        const payload = rows.map((l) => ({ account: l.account, debit: calc(l.debit) || 0, credit: calc(l.credit) || 0, remarks: l.remarks || null, ...dims() }));
        if (currency !== "SAR") {
          const rate = calc(fxRate);
          if (!rate || rate <= 0) throw new Error("Enter the exchange rate for " + currency);
          rpc = "gl_journal_fx";
          args = { p_company: COMPANY_ID, p_date: date, p_narration: narration || null, p_reference: reference || null, p_currency: currency, p_rate: rate, p_lines: payload };
        } else {
          rpc = "gl_journal";
          args = { p_company: COMPANY_ID, p_date: date, p_narration: narration || null, p_reference: reference || null, p_lines: payload };
        }
      } else if (isContra) {
        const amt = calc(amount);
        if (!cash || !toAcct) throw new Error("Choose both accounts");
        if (cash === toAcct) throw new Error("From and To must differ");
        if (!amt || amt <= 0) throw new Error("Enter an amount");
        rpc = "gl_contra";
        args = { p_company: COMPANY_ID, p_date: date, p_from: cash, p_to: toAcct, p_amount: amt, p_narration: narration || null };
      } else {
        if (!cash) throw new Error(`Choose the cash / bank account`);
        const hasAlloc = lines.some((l) => (l.alloc?.length ?? 0) > 0);
        if (hasAlloc) {
          // Bill-wise: post + settle specific outstanding bills in one step.
          const payload = lines.filter((l) => l.account && calc(l.amount)).map((l) => ({
            account: l.account, amount: calc(l.amount) || 0, remarks: l.remarks || null, ...dims(),
            allocations: (l.alloc ?? []).map((a) => ({ open_item_id: a.open_item_id, amount: a.amount })),
          }));
          if (payload.length < 1) throw new Error("Enter at least one line");
          const { data, error } = await supabase.rpc("gl_receipt_billwise", {
            p_company: COMPANY_ID, p_kind: kind === "receipt" ? "customer" : "supplier",
            p_date: date, p_cash_bank: cash, p_narration: narration || null, p_reference: reference || null, p_lines: payload,
          });
          if (error) throw new Error(error.message);
          setDone(`posted ${(data as any)?.entry_no ?? ""} (bill-wise)`);
          resetToNew(); router.refresh();
          if (printAfter && (data as any)?.entry_id) window.open(`/accounting/vouchers/${(data as any).entry_id}`, "_blank");
          return;
        }
        const payload = lines.filter((l) => l.account && calc(l.amount))
          .map((l) => ({ account: l.account, amount: calc(l.amount) || 0, remarks: l.remarks || null, ...dims() }));
        if (payload.length < 1) throw new Error("Enter at least one line");
        rpc = variant ? variant.postRpc : (kind === "receipt" ? "gl_receipt" : "gl_payment");
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
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 pb-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
        {readOnly && <span className="badge badge-neutral">Locked</span>}
        {done && <span className="badge badge-success capitalize">{done}</span>}
      </div>

      {/* Record toolbar */}
      <div className="panel flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" onClick={resetToNew} disabled={busy} className="btn-outline btn-sm">New</button>
        <button type="button" onClick={() => nav("prev")} disabled={busy} className="btn-outline btn-sm">‹ Previous</button>
        <button type="button" onClick={() => nav("next")} disabled={busy} className="btn-outline btn-sm">Next ›</button>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={printVoucher} disabled={!entryId || !may("print")} title={may("print") ? undefined : "You don't have Print rights on this voucher"} className="btn-outline btn-sm disabled:opacity-40">Print</button>
          <button type="button" onClick={del} disabled={!entryId || !editable || busy || !may("delete")} title={may("delete") ? undefined : "You don't have Delete rights on this voucher"} className="btn-outline btn-sm text-danger disabled:opacity-40">Delete</button>
        </div>
      </div>

      {error && <div className="rounded-md border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{error}</div>}
      {readOnly && <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">This voucher was generated by another module or has allocations — it is read-only here.</div>}

      <div className="card space-y-4">
        {/* Header */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div><label className="label">Document No.</label>
            <input className="input font-mono" value={docField} placeholder="Auto (type a no. + Enter to open)"
              onChange={(e) => setDocField(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); loadByDoc(); } }}
              title="Auto-assigned on save. Type an existing number and press Enter to open it." /></div>
          <div><label className="label">Date</label>
            <input type="date" className="input" value={date} disabled={readOnly} onChange={(e) => setDate(e.target.value)} /></div>
          {!isJournal && (
            <div className="md:col-span-1"><label className="label">{isContra ? "From (cash/bank)" : (variant?.cashLabel ?? "Cash / Bank")}</label>
              <AccountPicker accounts={payAccounts} value={cash} onChange={setCash} placeholder={variant?.cashLabel ?? "Cash / bank…"} /></div>
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
          {!isContra && (
            <div><label className="label">Cost Center</label>
              <select className="input" value={costCenter} disabled={readOnly} onChange={(e) => setCostCenter(e.target.value)}>
                <option value="">—</option>{costCenters.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select></div>
          )}
          {!isContra && (
            <div><label className="label">Tag Area</label>
              <select className="input" value={tagArea} disabled={readOnly} onChange={(e) => setTagArea(e.target.value)}>
                <option value="">—</option>{tagAreas.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select></div>
          )}
          {isJournal && !entryId && (
            <>
              <div><label className="label">Currency</label>
                <select className="input" value={currency} onChange={(e) => pickCurrency(e.target.value)}>
                  <option value="SAR">SAR (base)</option>
                  {currencies.filter((c) => c.code !== "SAR").map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select></div>
              {currency !== "SAR" && (
                <div><label className="label">Rate → SAR</label>
                  <input className="input text-right tabular-nums" inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="0.00" /></div>
              )}
            </>
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
                  <th className="px-2 py-2 text-left">{variant?.lineLabel ?? "Account"}</th>
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
                        onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} onBlur={() => maybeAutoAdjust(i)} /></td>
                      <td className="px-2 py-1"><input className="input text-right tabular-nums" inputMode="decimal" value={l.credit} disabled={readOnly}
                        onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} onBlur={() => maybeAutoAdjust(i)} /></td>
                    </> : (
                      <td className="px-2 py-1"><input className="input text-right tabular-nums" inputMode="decimal" value={l.amount} disabled={readOnly}
                        onChange={(e) => setLine(i, { amount: e.target.value })} onBlur={() => maybeAutoAdjust(i)} /></td>
                    )}
                    <td className="px-2 py-1"><input className="input" value={l.remarks} disabled={readOnly} onChange={(e) => setLine(i, { remarks: e.target.value })} /></td>
                    <td className="px-1 whitespace-nowrap text-center">
                      {canBillwise && !entryId && (l.alloc?.length ?? 0) > 0 && (
                        <button type="button" onClick={() => openAdjust(i)}
                          className="mr-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700"
                          title="Bill-wise adjustment — click to review">✓ {l.alloc!.length}</button>
                      )}
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
          <button onClick={() => save(false)} disabled={saving || readOnly || (isJournal && !balanced) || !(entryId ? may("edit") : may("create"))} className="btn">
            {!(entryId ? may("edit") : may("create")) ? (entryId ? "No Edit rights" : "No Create rights")
              : saving ? (entryId ? "Saving…" : "Posting…") : entryId ? "Save changes" : "Save & Post"}
            {(entryId ? may("edit") : may("create")) && <span className="ml-1 opacity-70 text-xs">Ctrl+S</span>}
          </button>
          {!isContra && !readOnly && <button type="button" onClick={() => setLines((l) => [...l, emptyLine()])} className="btn-outline text-sm">+ Line</button>}
          <span className="ml-auto text-xs text-slate-400">{entryId ? "Editing an existing voucher — the document number is kept." : "Posts to the ledger immediately — no separate posting step."}</span>
        </div>
      </div>

      {/* Bill-wise adjustment modal */}
      {adjustFor != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAdjustFor(null)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">Bill-wise Adjustment</h2>
              <button onClick={() => setAdjustFor(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
            </div>
            {billErr && <div className="mb-2 rounded-md border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{billErr}</div>}
            {bills.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No outstanding bills for this account. The full amount will post <b>on account</b>.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <tr><th className="px-2 py-2 text-left">Reference</th><th className="px-2 py-2">Due date</th>
                      <th className="px-2 py-2 text-right">Bill</th><th className="px-2 py-2 text-right">Outstanding</th><th className="px-2 py-2 text-right">Adjust</th></tr>
                  </thead>
                  <tbody>
                    {bills.map((b) => (
                      <tr key={b.id} className="border-t border-slate-100">
                        <td className="px-2 py-1">{b.doc_no ?? "—"}{b.doc_date ? <span className="text-slate-400"> · {b.doc_date}</span> : ""}</td>
                        <td className="px-2 py-1 text-center">{b.due_date ?? "—"}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{money(Number(b.amount))}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{money(Number(b.outstanding))}</td>
                        <td className="px-2 py-1">
                          <input className="input text-right tabular-nums" inputMode="decimal" value={allocInput[b.id] ?? ""}
                            onChange={(e) => setAllocInput((m) => ({ ...m, [b.id]: e.target.value }))} placeholder="0.00" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              <span>Amount to adjust: <b className="tabular-nums">{money(adjTarget)}</b></span>
              <span>Adjusted: <b className="tabular-nums">{money(adjDone)}</b></span>
              <span className={Math.abs(adjTarget - adjDone) < 0.005 ? "text-emerald-700" : "text-amber-700"}>On account: <b className="tabular-nums">{money(Math.max(0, adjTarget - adjDone))}</b></span>
              {bills.length > 0 && <button onClick={fillFifo} className="btn-outline text-xs">Auto FIFO</button>}
              {bills.length > 0 && <button onClick={() => setAllocInput({})} className="btn-outline text-xs">Clear</button>}
              <div className="ml-auto flex gap-2">
                <button onClick={() => setAdjustFor(null)} className="btn-outline text-sm">Cancel</button>
                <button onClick={saveAdjust} className="btn text-sm">OK</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
