"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, dateStr } from "@/lib/format";
import { todaySA, yearSA } from "@/lib/saudiTime";
import AccountPickTree, { type PickNode } from "./AccountPickTree";

type Row = {
  entry_id: string; date: string; entry_no: string;
  tag_area: string | null; cost_center: string | null;
  contra: string | null; memo: string | null; reference: string | null;
  debit: number; credit: number;
};
type Block = {
  id: string; code: string; name: string; group: string | null;
  opening: number; total_debit: number; total_credit: number; closing: number; rows: Row[];
};
type Result = {
  accounts: Block[]; grand_debit: number; grand_credit: number;
  accounts_shown: number; accounts_asked: number;
};

const money = (n: any) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(Number(n) || 0));
const drcr = (n: number) => `${money(n)}${n >= 0 ? "Dr" : "Cr"}`;
const y = yearSA();

/**
 * Ledger — pick the accounts, pick the window, run it.
 *
 * It is one screen rather than a dialog and a viewer, because the dialog's only
 * job was to be dismissed: what you actually do is run it, look, change one
 * thing and run it again. The picker stays on the left and collapses out of the
 * way once there is something to read.
 *
 * The report is a BLOCK PER ACCOUNT — its own opening balance, its own running
 * balance, its own total — which is what a ledger is. Asking for forty accounts
 * and getting one merged running total, which is what the old RPC did when it
 * was handed a list, is a balance of something that does not exist.
 */
export default function LedgerReport({ nodes, initialAccount, initialFrom, initialTo }: {
  nodes: PickNode[]; initialAccount?: string; initialFrom?: string; initialTo?: string;
}) {
  const supabase = createClient();
  // Trial Balance, Aging and the chart itself link straight here with one
  // account in the URL. That has to keep working: land on it, already run.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialAccount ? [initialAccount] : []));
  const [from, setFrom] = useState(initialFrom || `${y}-01-01`);
  const [to, setTo] = useState(initialTo || todaySA());
  const [onlyBal, setOnlyBal] = useState(true);
  const [movedOnly, setMovedOnly] = useState(false);
  const [pageBreak, setPageBreak] = useState(false);
  const [showIndex, setShowIndex] = useState(false);
  const [sort, setSort] = useState("code");
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(true);

  const nameOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.name])), [nodes]);

  const runWith = useCallback(async (ids: string[], opts?: { onlyBal?: boolean }) => {
    if (ids.length === 0) { setErr("Tick at least one account on the left."); return; }
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("acct_ledger_multi", {
      p_company: COMPANY_ID,
      p_account_ids: ids,
      p_from: from || null,
      p_to: to || null,
      p_only_with_balance: opts?.onlyBal ?? onlyBal,
      p_moved_only: movedOnly,
      p_sort: sort,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setRes(data as Result);
    setPickerOpen(false);
  }, [supabase, from, to, onlyBal, movedOnly, sort]);

  const run = () => runWith(Array.from(checked));

  // Arriving from a link. Once only — after that the buttons are in charge.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !initialAccount) return;
    arrived.current = true;
    // One account asked for by name is always wanted, empty or not.
    runWith([initialAccount], { onlyBal: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAccount]);

  // Excel opens a CSV without being asked to import anything, which is what
  // "Export" meant on the old dialog. A BOM so Arabic account names survive.
  function toCsv() {
    if (!res) return;
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const out: string[] = [["Account", "Date", "Voucher No", "Tag Area", "Cost Center", "Contra Account", "Remarks", "Debit", "Credit", "Balance"].map(esc).join(",")];
    for (const b of res.accounts) {
      let bal = Number(b.opening);
      out.push([b.name, "", "", "", "", "", "Opening Balance", "", "", bal.toFixed(2)].map(esc).join(","));
      for (const r of b.rows) {
        bal += Number(r.debit) - Number(r.credit);
        out.push([b.name, r.date, r.entry_no, r.tag_area ?? "", r.cost_center ?? "", r.contra ?? "",
                  r.memo ?? "", Number(r.debit).toFixed(2), Number(r.credit).toFixed(2), bal.toFixed(2)].map(esc).join(","));
      }
      out.push([b.name, "", "", "", "", "", "Total", Number(b.total_debit).toFixed(2), Number(b.total_credit).toFixed(2), bal.toFixed(2)].map(esc).join(","));
    }
    out.push(["", "", "", "", "", "", "Grand Total", Number(res.grand_debit).toFixed(2), Number(res.grand_credit).toFixed(2), ""].map(esc).join(","));
    const blob = new Blob(["﻿" + out.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ledger-${from || "start"}-to-${to || "today"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-4">
      <div className="no-print grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className={`card p-0 ${pickerOpen ? "" : "hidden lg:block"}`}>
          <div className="border-b border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Accounts
          </div>
          <AccountPickTree nodes={nodes} checked={checked} onChange={setChecked} />
        </div>

        <div className="card space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><label className="label">From</label>
              <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label className="label">To</label>
              <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div><label className="label">Sort by</label>
              <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="code">Account code</option>
                <option value="name">Account name</option>
                <option value="balance">Largest balance</option>
              </select></div>
          </div>

          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <label className="flex items-center gap-2 text-slate-600">
              <input type="checkbox" checked={onlyBal} onChange={(e) => setOnlyBal(e.target.checked)} />
              Only accounts with balances
            </label>
            <label className="flex items-center gap-2 text-slate-600">
              <input type="checkbox" checked={movedOnly} onChange={(e) => setMovedOnly(e.target.checked)} />
              Only accounts that moved in the period
            </label>
            <label className="flex items-center gap-2 text-slate-600">
              <input type="checkbox" checked={pageBreak} onChange={(e) => setPageBreak(e.target.checked)} />
              Start each account on a new page
            </label>
            <label className="flex items-center gap-2 text-slate-600">
              <input type="checkbox" checked={showIndex} onChange={(e) => setShowIndex(e.target.checked)} />
              Print an index
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <button onClick={run} disabled={busy || checked.size === 0} className="btn disabled:opacity-40">
              {busy ? "Running…" : `Run${checked.size ? ` · ${checked.size} account${checked.size === 1 ? "" : "s"}` : ""}`}
            </button>
            <button onClick={() => setPickerOpen((o) => !o)} className="btn-outline text-sm lg:hidden">
              {pickerOpen ? "Hide accounts" : "Choose accounts"}
            </button>
            {res && <>
              <button onClick={() => window.print()} className="btn-outline text-sm ml-auto">🖨 Print / PDF</button>
              <button onClick={toCsv} className="btn-outline text-sm">⤓ Excel (CSV)</button>
            </>}
          </div>

          {err && <p className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</p>}
          {res && (
            <p className="text-xs text-slate-400">
              {res.accounts_shown} of {res.accounts_asked} account{res.accounts_asked === 1 ? "" : "s"} shown
              {res.accounts_shown < res.accounts_asked && " — the rest were filtered out by the options above"}.
            </p>
          )}
        </div>
      </div>

      {res && (
        <div className="card p-0">
          <div className="border-b border-slate-200 p-3">
            <h2 className="font-semibold text-slate-800">
              Ledger {from && to ? `(${dateStr(from)} to ${dateStr(to)})` : from ? `(from ${dateStr(from)})` : to ? `(to ${dateStr(to)})` : ""}
            </h2>
          </div>

          {showIndex && res.accounts.length > 1 && (
            <div className="keep-together border-b border-slate-200 p-3">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Index</h3>
              <ol className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {res.accounts.map((b) => (
                  <li key={b.id} className="flex justify-between gap-2">
                    <a href={`#acct-${b.id}`} className="min-w-0 truncate text-brand hover:underline">{b.name}</a>
                    <span className="shrink-0 tabular-nums text-slate-500">{drcr(Number(b.closing))}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {res.accounts.map((b, bi) => {
            let bal = Number(b.opening);
            return (
              <div key={b.id} id={`acct-${b.id}`}
                   className={`${pageBreak && bi > 0 ? "page-break" : ""} border-b border-slate-200 last:border-b-0`}>
                <div className="flex flex-wrap items-baseline gap-x-3 bg-amber-50/70 px-3 py-1.5">
                  <span className="font-semibold text-slate-800">{b.name}</span>
                  <span className="font-mono text-[11px] text-slate-400">{b.code}</span>
                  {b.group && <span className="text-xs text-slate-400">in {b.group}</span>}
                  <span className="ml-auto text-xs text-slate-500">Closing <b className="tabular-nums">{drcr(Number(b.closing))}</b></span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Date</th>
                        <th className="px-2 py-1.5 text-left">Voucher No</th>
                        <th className="px-2 py-1.5 text-left">Tag Area</th>
                        <th className="px-2 py-1.5 text-left">Account</th>
                        <th className="px-2 py-1.5 text-left">Remarks</th>
                        <th className="px-2 py-1.5 text-right">Debit</th>
                        <th className="px-2 py-1.5 text-right">Credit</th>
                        <th className="px-2 py-1.5 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-slate-100">
                        <td className="px-2 py-1" colSpan={4} />
                        <td className="px-2 py-1 text-slate-500">Opening Balance</td>
                        <td className="px-2 py-1 text-right tabular-nums">{Number(b.opening) > 0 ? money(b.opening) : ""}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{Number(b.opening) < 0 ? money(b.opening) : ""}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{drcr(Number(b.opening))}</td>
                      </tr>
                      {b.rows.map((r, i) => {
                        bal += Number(r.debit) - Number(r.credit);
                        return (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="whitespace-nowrap px-2 py-1">{dateStr(r.date)}</td>
                            <td className="px-2 py-1">
                              <Link href={`/accounting/vouchers/${r.entry_id}`} className="font-mono text-xs text-brand hover:underline">{r.entry_no}</Link>
                            </td>
                            <td className="px-2 py-1 text-xs text-slate-500">{r.tag_area ?? "NONE"}</td>
                            <td className="px-2 py-1 text-slate-600">{r.contra ?? "—"}</td>
                            <td className="px-2 py-1 text-slate-500">{r.memo ?? ""}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{Number(r.debit) ? money(r.debit) : ""}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{Number(r.credit) ? money(r.credit) : ""}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{drcr(bal)}</td>
                          </tr>
                        );
                      })}
                      {b.rows.length === 0 && (
                        <tr className="border-t border-slate-100">
                          <td className="px-2 py-3 text-center text-slate-400" colSpan={8}>Nothing in this period.</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                        <td className="px-2 py-1.5" colSpan={5}>Total</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(b.total_debit)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(b.total_credit)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{drcr(Number(b.closing))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })}

          {res.accounts.length === 0 && (
            <p className="p-6 text-center text-slate-400">
              Nothing to show — every account you picked was filtered out by the options.
            </p>
          )}

          {res.accounts.length > 0 && (
            <div className="keep-together flex items-center gap-4 border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold">
              <span>Grand Total</span>
              <span className="ml-auto w-32 text-right tabular-nums">{money(res.grand_debit)}</span>
              <span className="w-32 text-right tabular-nums">{money(res.grand_credit)}</span>
              <span className="w-32" />
            </div>
          )}
        </div>
      )}

      {!res && (
        <div className="card text-slate-400">
          Tick the accounts on the left — a group ticks everything under it — then Run.
        </div>
      )}
    </div>
  );
}
