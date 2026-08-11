"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { dateStr } from "@/lib/format";
import VisaInvoiceCheck from "./VisaInvoiceCheck";
import { VISA_TYPE_LABEL } from "./VisaLedgerRange";

export interface VisaLedgerRow {
  group_id: string;
  visa_date: string | null;
  company: string | null;
  customer: string | null;
  group_name: string | null;
  group_no: string | null;
  visa_type: string | null;
  total_nights: number | null;
  pax: number | null;
  invoice_created: boolean;
}

export default function VisaLedgerTable({ rows, isAdmin }: { rows: VisaLedgerRow[]; isAdmin: boolean }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.company, r.customer, r.group_name, r.group_no, VISA_TYPE_LABEL[r.visa_type ?? ""] ?? r.visa_type]
        .some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [rows, search]);

  const totPax = filtered.reduce((a, r) => a + Number(r.pax || 0), 0);

  return (
    <div className="card">
      <div className="no-print mb-3">
        <input className="input max-w-xs" placeholder="Search company / customer / group…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="th">Date</th><th className="th">Company</th><th className="th">Customer</th>
            <th className="th">Name</th><th className="th">Group No</th><th className="th">Visa Type</th>
            <th className="th text-right">Nights</th><th className="th text-right">Pax</th><th className="th">Invoice</th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.group_id} className="border-b border-slate-50 align-middle">
                <td className="td whitespace-nowrap">{dateStr(r.visa_date)}</td>
                <td className="td">{r.company ?? "—"}</td>
                <td className="td">{r.customer ?? "—"}</td>
                <td className="td">{r.group_name ?? "—"}</td>
                <td className="td font-medium"><Link href={`/groups/${r.group_id}`} className="text-brand hover:underline">{r.group_no ?? "—"}</Link></td>
                <td className="td">{VISA_TYPE_LABEL[r.visa_type ?? ""] ?? r.visa_type ?? "—"}</td>
                <td className="td text-right tabular-nums">{r.total_nights ?? "—"}</td>
                <td className="td text-right tabular-nums">{r.pax ?? "—"}</td>
                <td className="td"><VisaInvoiceCheck groupId={r.group_id} done={r.invoice_created} isAdmin={isAdmin} /></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="td text-center text-slate-400">No visa groups in this range.</td></tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot><tr className="border-t-2 border-slate-200 font-semibold text-slate-700">
              <td className="td" colSpan={7}>Total ({filtered.length})</td>
              <td className="td text-right tabular-nums">{totPax}</td>
              <td className="td"></td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
