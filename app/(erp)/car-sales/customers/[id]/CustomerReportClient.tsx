"use client";

import { Fragment, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateStr, monthShort } from "@/lib/format";
import { sar } from "../../lib";
import SectionHeader from "@/components/reports/SectionHeader";
import TrendChart from "@/components/reports/charts/TrendChart";

type ByType = { type_group: string; billed: number; receipts: number; bill_balance: number; due: number; overdue: number; total_dues: number };
type Bill = { doc_no: string; doc_date: string; due_date: string | null; type_group: string; amount: number; adjusted: number; balance: number; status: string; entry_id: string };
type Month = { month: string; due: number; receipt: number };

const TYPE_LABEL: Record<string, string> = { car_invoice: "Car Invoice", service_charge: "Service Charges", other: "Other" };
const TYPES = ["car_invoice", "service_charge", "other"];

const money = (n: number) => n ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : "0.00";

type GlLine = { debit: number; credit: number; description: string | null; account: { code: string; name: string } | null };

// A bill's own voucher, opened in place — the same journal_lines a Load or
// the Ledger reads, not a re-derived guess. There is no dedicated GL-lines
// RPC because journal_lines is already RLS-scoped per staff restrictions,
// exactly the way acct_ledger's own rows are — a direct client read is the
// same access a staff user already has, just for one entry instead of a
// whole account's history.
function BillDrilldown({ entryId }: { entryId: string }) {
  const [lines, setLines] = useState<GlLine[] | null>(null);
  const [busy, setBusy] = useState(true);

  useMemo(() => {
    let cancelled = false;
    (async () => {
      const sb = createClient();
      const { data } = await sb
        .from("journal_lines")
        .select("debit, credit, description, account:account_id(code, name)")
        .eq("entry_id", entryId)
        .order("created_at");
      if (!cancelled) { setLines((data as any) ?? []); setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [entryId]);

  if (busy) return <p className="px-3 py-2 text-xs text-slate-400">Loading voucher lines…</p>;
  if (!lines || lines.length === 0) return <p className="px-3 py-2 text-xs text-slate-400">No posted lines found for this voucher.</p>;

  return (
    <table className="report-grid w-full text-xs">
      <thead className="text-slate-400"><tr>
        <th className="px-2 py-1 text-left font-semibold uppercase tracking-wide">Account</th>
        <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide">Debit</th>
        <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide">Credit</th>
        <th className="px-2 py-1 text-left font-semibold uppercase tracking-wide">Remarks</th>
      </tr></thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className="border-t border-slate-200">
            <td className="px-2 py-1">{l.account ? `${l.account.code} · ${l.account.name}` : "—"}</td>
            <td className="px-2 py-1 text-right tabular-nums">{Number(l.debit) ? money(Number(l.debit)) : ""}</td>
            <td className="px-2 py-1 text-right tabular-nums">{Number(l.credit) ? money(Number(l.credit)) : ""}</td>
            <td className="px-2 py-1">{l.description ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function CustomerReportClient({ byType, bills, monthwise }: { byType: ByType[]; bills: Bill[]; monthwise: Month[] }) {
  const [types, setTypes] = useState<Set<string>>(new Set(TYPES));
  const [openBill, setOpenBill] = useState<string | null>(null);

  function toggleType(t: string) {
    setTypes((s) => {
      const n = new Set(s);
      if (n.has(t)) { if (n.size > 1) n.delete(t); } else n.add(t);
      return n;
    });
  }

  const kpi = useMemo(() => {
    const rows = byType.filter((r) => types.has(r.type_group));
    return rows.reduce((a, r) => ({
      billed: a.billed + Number(r.billed), receipts: a.receipts + Number(r.receipts),
      bill_balance: a.bill_balance + Number(r.bill_balance), due: a.due + Number(r.due),
      overdue: a.overdue + Number(r.overdue), total_dues: a.total_dues + Number(r.total_dues),
    }), { billed: 0, receipts: 0, bill_balance: 0, due: 0, overdue: 0, total_dues: 0 });
  }, [byType, types]);

  const filteredBills = useMemo(() => bills.filter((b) => types.has(b.type_group)), [bills, types]);

  return (
    <>
      <section>
        <SectionHeader title="Invoice Type" />
        <div className="mb-3 flex flex-wrap gap-2">
          {TYPES.filter((t) => byType.some((r) => r.type_group === t)).map((t) => (
            <button key={t} onClick={() => toggleType(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${types.has(t) ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
              {TYPE_LABEL[t] ?? t}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Billed Amount", kpi.billed, ""],
            ["Receipts", kpi.receipts, "text-emerald-700"],
            ["Bill Balance", kpi.bill_balance, ""],
            ["Due", kpi.due, "text-amber-700"],
            ["Overdue", kpi.overdue, "text-red-600"],
            ["Total Dues", kpi.total_dues, "font-bold"],
          ].map(([label, value, tone]) => (
            <div key={label as string} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
              <div className={`text-base font-bold tabular-nums ${tone}`}>{sar(value as number)}</div>
            </div>
          ))}
        </div>
      </section>

      {monthwise.length > 1 && (
        <section>
          <SectionHeader title="Monthwise Receivables" />
          <div className="card">
            <TrendChart
              data={monthwise.map((m) => ({ ...m, month: monthShort(m.month) }))}
              xKey="month"
              series={[{ key: "due", label: "Due" }, { key: "receipt", label: "Received" }]}
            />
          </div>
        </section>
      )}

      <section>
        <SectionHeader title="Bills and Adjustments" />
        <div className="card overflow-x-auto p-0">
          <table className="report-grid w-full text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr>
                <th className="px-3 py-2 text-left"><span className="col-resize">Voucher No</span></th>
                <th className="px-3 py-2 text-left"><span className="col-resize">Date</span></th>
                <th className="px-3 py-2 text-left"><span className="col-resize">Type</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">Amount</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">Adjusted</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">Balance</span></th>
                <th className="px-3 py-2 text-left"><span className="col-resize">Due Date</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredBills.map((b, i) => {
                const isOpen = openBill === `${b.entry_id}-${b.doc_no}`;
                const key = `${b.entry_id}-${b.doc_no}`;
                return (
                  <Fragment key={key}>
                    <tr className={`cursor-pointer ${i % 2 === 1 ? "bg-slate-100/80" : ""}`} onClick={() => setOpenBill(isOpen ? null : key)}>
                      <td className="px-3 py-2">
                        <span className="mr-1.5 inline-block w-3 text-slate-400">{isOpen ? "▾" : "▸"}</span>
                        {b.doc_no}
                      </td>
                      <td className="px-3 py-2">{dateStr(b.doc_date)}</td>
                      <td className="px-3 py-2">{TYPE_LABEL[b.type_group] ?? b.type_group}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(Number(b.amount))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(Number(b.adjusted))}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${b.status === "open" ? "text-amber-700" : ""}`}>{money(Number(b.balance))}</td>
                      <td className="px-3 py-2">{b.due_date ? dateStr(b.due_date) : "—"}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={7} className="p-0">
                          <BillDrilldown entryId={b.entry_id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filteredBills.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No bills for this selection.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
