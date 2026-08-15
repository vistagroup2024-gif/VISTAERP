"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { dateStr } from "@/lib/format";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import { sar } from "../lib";

export interface ReceiptRow {
  id: string; receipt_no: string; receipt_date: string | null; amount: number; method: string;
  reference: string | null; contract_id: string | null; contract_no: string | null; customer: string | null;
}

const METHODS = ["cash", "bank", "card", "transfer"];

export default function ReceiptsTable({ rows }: { rows: ReceiptRow[] }) {
  const [q, setQ] = useState("");
  const [method, setMethod] = useState<string[]>([]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (method.length && !method.includes(r.method)) return false;
    if (q && ![r.receipt_no, r.contract_no, r.customer, r.reference].filter(Boolean).join(" ").toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [rows, q, method]);

  const total = filtered.reduce((a, r) => a + r.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search receipt / contract / customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <MultiSelectFilter label="Method" options={METHODS.map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }))} selected={method} onChange={setMethod} />
        <span className="ml-auto text-sm text-slate-500">{filtered.length} / {rows.length} · {sar(total)}</span>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Receipt</th><th className="th">Date</th><th className="th">Customer</th>
            <th className="th">Contract</th><th className="th">Method</th><th className="th">Reference</th><th className="th text-right">Amount</th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="td font-medium"><Link href={`/car-sales/receipts/${r.id}`} className="text-brand hover:underline">{r.receipt_no}</Link></td>
                <td className="td">{dateStr(r.receipt_date)}</td>
                <td className="td">{r.customer ?? "—"}</td>
                <td className="td">{r.contract_id ? <Link href={`/car-sales/contracts/${r.contract_id}`} className="text-brand hover:underline">{r.contract_no}</Link> : "—"}</td>
                <td className="td capitalize">{r.method}</td>
                <td className="td">{r.reference ?? "—"}</td>
                <td className="td text-right tabular-nums">{sar(r.amount)}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No receipts.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
