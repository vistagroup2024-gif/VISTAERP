"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, dateStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import { defaultYearMonths, monthRanges, type YearMonths } from "@/lib/reports/period";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// Trial Balance — a genuine period report (Opening/Period/Closing columns
// need a bounded window, unlike the Balance Sheet's plain snapshot), so
// Year+Months resolves to the bounding {from,to} of the months picked
// (trial_balance() takes one p_from/p_to pair, same as before). Defaults to
// the current year rather than the old blank-form's "since inception" —
// the same default every other period report in the ERP now opens on.
export default function TrialBalanceView() {
  const sb = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);
  const [rows, setRows] = useState<any[]>([]);

  const ranges = monthRanges(ym);
  const from = ranges[0]?.from ?? `${ym.year}-01-01`;
  const to = ranges[ranges.length - 1]?.to ?? `${ym.year}-12-31`;

  useEffect(() => {
    let live = true;
    sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: from, p_to: to }).then(({ data }) => {
      if (live) setRows((data as any[]) ?? []);
    });
    return () => { live = false; };
  }, [sb, from, to]);

  const closingDr = (r: any) => (r.closing_net >= 0 ? r.closing_net : 0);
  const closingCr = (r: any) => (r.closing_net < 0 ? -r.closing_net : 0);
  const totDr = rows.reduce((s, r) => s + closingDr(r), 0);
  const totCr = rows.reduce((s, r) => s + closingCr(r), 0);
  const balanced = Math.abs(totDr - totCr) < 0.005;

  return (
    <div className="space-y-4">
      <PageHeader title={`Trial Balance — ${dateStr(from)} to ${dateStr(to)}`}>
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>
      <div className="card flex items-center">
        <span className={`ml-auto rounded-full px-3 py-1 text-sm font-medium ${balanced ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {balanced ? "Balanced ✓" : `Out of balance by ${money(Math.abs(totDr - totCr))}`}
        </span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="report-grid w-full text-sm">
          <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
            <tr>
              <th className="px-3 py-2 text-left"><span className="col-resize">Account</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">Opening Dr</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">Opening Cr</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">Period Dr</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">Period Cr</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">Closing Dr</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">Closing Cr</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/70" : ""}`}>
                <td className="px-3 py-1.5"><Link href={`/accounting/ledger?account=${r.id}&from=${from}&to=${to}`} className="hover:text-brand hover:underline">{r.name}</Link></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.opening_debit) ? money(Number(r.opening_debit)) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.opening_credit) ? money(Number(r.opening_credit)) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.period_debit) ? money(Number(r.period_debit)) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.period_credit) ? money(Number(r.period_credit)) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{closingDr(r) ? money(closingDr(r)) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{closingCr(r) ? money(closingCr(r)) : ""}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={8}>No account activity.</td></tr>}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-3 py-2" colSpan={6}>Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(totDr)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(totCr)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
