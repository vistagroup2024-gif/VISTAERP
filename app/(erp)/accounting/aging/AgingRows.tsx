"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, dateStr } from "@/lib/format";
import WhatsAppButton from "@/components/WhatsAppButton";
import { waMsg } from "@/lib/waMessages";

const money = (n: number) => n ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : "";

type Row = {
  account_id: string; name: string; phone: string | null;
  total: number; not_due: number; b0: number; b1: number; b2: number; b3: number; b4: number; ledger_balance: number;
};
type Bill = { id: string; doc_no: string; doc_date: string; due_date: string | null; amount: number; outstanding: number; status: string };

// Bill-level drill-down — party_outstanding() already exists (it is what the
// voucher's own bill-wise-adjustment popup reads), just never surfaced on a
// report before. Invoice/Bill No, Amount, Adjusted, Balance, Due Date, per
// open bill, without a new RPC.
export default function AgingRows({ rows, kind }: { rows: Row[]; kind: "customer" | "supplier" }) {
  const [open, setOpen] = useState<string | null>(null);
  const [bills, setBills] = useState<Record<string, Bill[]>>({});
  const [busy, setBusy] = useState(false);

  async function toggle(accountId: string) {
    if (open === accountId) { setOpen(null); return; }
    setOpen(accountId);
    if (bills[accountId]) return;
    setBusy(true);
    const sb = createClient();
    const { data } = await sb.rpc("party_outstanding", { p_company: COMPANY_ID, p_account_id: accountId });
    setBusy(false);
    setBills((b) => ({ ...b, [accountId]: (data as Bill[]) ?? [] }));
  }

  return (
    <>
      {rows.map((r) => {
        const isOpen = open === r.account_id;
        const rowBills = bills[r.account_id] ?? [];
        return (
          <Fragment key={r.account_id}>
            <tr className="border-t border-slate-100">
              <td className="px-3 py-1.5">
                <button onClick={() => toggle(r.account_id)} className="mr-1.5 text-slate-400 hover:text-slate-700" aria-label={isOpen ? "Collapse" : "Expand"}>
                  {isOpen ? "▾" : "▸"}
                </button>
                <Link href={`/accounting/customers/${r.account_id}`} className="hover:text-brand hover:underline">{r.name}</Link>
                {r.phone ? <span className="ml-2 text-xs text-slate-400">{r.phone}</span> : ""}
              </td>
              <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{money(Number(r.total))}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{money(Number(r.not_due))}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(r.b0))}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(r.b1))}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(r.b2))}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(r.b3))}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-red-600">{money(Number(r.b4))}</td>
              <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${Math.abs(Number(r.ledger_balance) - Number(r.total)) > 0.5 ? "text-amber-700" : ""}`}
                title={Math.abs(Number(r.ledger_balance) - Number(r.total)) > 0.5 ? "Differs from the billed total — a receipt or payment was saved on account, not adjusted against a bill." : undefined}>
                {money(Number(r.ledger_balance))}
              </td>
              <td className="sticky right-0 bg-white px-3 py-1.5 text-right shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.12)] print:hidden">
                {kind === "customer" && <WhatsAppButton phone={r.phone} label="Remind"
                  message={waMsg.paymentReminder({ name: r.name, amount: Number(r.total), currency: "SAR" })} />}
              </td>
            </tr>
            {isOpen && (
              <tr className="border-t border-slate-100 bg-slate-50/60">
                <td colSpan={10} className="px-3 py-2">
                  {busy && !bills[r.account_id] ? (
                    <p className="text-xs text-slate-400">Loading bills…</p>
                  ) : rowBills.length === 0 ? (
                    <p className="text-xs text-slate-400">No open bills — the balance above comes from the ledger, not from an adjustable bill.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="text-slate-400"><tr>
                        <th className="px-2 py-1 text-left font-semibold uppercase tracking-wide">Bill No</th>
                        <th className="px-2 py-1 text-left font-semibold uppercase tracking-wide">Bill Date</th>
                        <th className="px-2 py-1 text-left font-semibold uppercase tracking-wide">Due Date</th>
                        <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide">Amount</th>
                        <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide">Adjusted</th>
                        <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide">Balance</th>
                      </tr></thead>
                      <tbody>
                        {rowBills.map((b) => (
                          <tr key={b.id} className="border-t border-slate-200">
                            <td className="px-2 py-1">{b.doc_no}</td>
                            <td className="px-2 py-1">{dateStr(b.doc_date)}</td>
                            <td className="px-2 py-1">{b.due_date ? dateStr(b.due_date) : "—"}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{money(Number(b.amount))}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{money(Number(b.amount) - Number(b.outstanding))}</td>
                            <td className="px-2 py-1 text-right tabular-nums font-medium">{money(Number(b.outstanding))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
