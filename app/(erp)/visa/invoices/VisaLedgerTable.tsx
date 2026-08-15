"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { dateStr } from "@/lib/format";
import MultiSelectFilter from "@/components/MultiSelectFilter";
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
  const [company, setCompany] = useState<string[]>([]);
  const [customer, setCustomer] = useState<string[]>([]);
  const [visaType, setVisaType] = useState<string[]>([]);
  const [invoice, setInvoice] = useState<string[]>([]);

  const companies = useMemo(() => Array.from(new Set(rows.map((r) => r.company).filter(Boolean))) as string[], [rows]);
  const customers = useMemo(() => Array.from(new Set(rows.map((r) => r.customer).filter(Boolean))) as string[], [rows]);
  const visaTypes = useMemo(() => Array.from(new Set(rows.map((r) => r.visa_type).filter(Boolean))) as string[], [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (company.length && !company.includes(r.company ?? "")) return false;
      if (customer.length && !customer.includes(r.customer ?? "")) return false;
      if (visaType.length && !visaType.includes(r.visa_type ?? "")) return false;
      if (invoice.length && !invoice.includes(r.invoice_created ? "created" : "pending")) return false;
      if (q && ![r.company, r.customer, r.group_name, r.group_no, VISA_TYPE_LABEL[r.visa_type ?? ""] ?? r.visa_type]
        .some((v) => String(v ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, company, customer, visaType, invoice]);

  const totPax = filtered.reduce((a, r) => a + Number(r.pax || 0), 0);

  return (
    <div className="card">
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search company / customer / group…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <MultiSelectFilter label="Company" options={companies.map((c) => ({ value: c, label: c }))} selected={company} onChange={setCompany} />
        <MultiSelectFilter label="Customer" options={customers.map((c) => ({ value: c, label: c }))} selected={customer} onChange={setCustomer} />
        <MultiSelectFilter label="Visa Type" options={visaTypes.map((v) => ({ value: v, label: VISA_TYPE_LABEL[v] ?? v }))} selected={visaType} onChange={setVisaType} />
        <MultiSelectFilter label="Invoice" options={[{ value: "pending", label: "Pending" }, { value: "created", label: "Created" }]} selected={invoice} onChange={setInvoice} />
        <span className="ml-auto text-sm text-slate-500">{filtered.length} / {rows.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="th">Date</th><th className="th">Company</th><th className="th">Customer</th>
            <th className="th">Name</th><th className="th">Group No</th><th className="th">Visa Type</th>
            <th className="th text-right">Nights</th><th className="th text-right">Pax</th><th className="th">Invoice</th>
            <th className="th no-print"></th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.group_id} className="border-b border-slate-50 align-middle">
                <td className="td whitespace-nowrap">{dateStr(r.visa_date)}</td>
                <td className="td">{r.company ?? "—"}</td>
                <td className="td">{r.customer ?? "—"}</td>
                <td className="td">{r.group_name ?? "—"}</td>
                <td className="td font-medium">{r.group_no ?? "—"}</td>
                <td className="td">{VISA_TYPE_LABEL[r.visa_type ?? ""] ?? r.visa_type ?? "—"}</td>
                <td className="td text-right tabular-nums">{r.total_nights ?? "—"}</td>
                <td className="td text-right tabular-nums">{r.pax ?? "—"}</td>
                <td className="td"><VisaInvoiceCheck groupId={r.group_id} done={r.invoice_created} isAdmin={isAdmin} /></td>
                <td className="td no-print text-right"><Link href={`/groups/${r.group_id}`} className="btn-outline whitespace-nowrap text-xs">Open</Link></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="td text-center text-slate-400">No visa groups in this range.</td></tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot><tr className="border-t-2 border-slate-200 font-semibold text-slate-700">
              <td className="td" colSpan={7}>Total ({filtered.length})</td>
              <td className="td text-right tabular-nums">{totPax}</td>
              <td className="td"></td>
              <td className="td no-print"></td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
