"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import RowMenu from "@/components/RowMenu";
import { PO_STATUS_LABEL, PO_STATUS_TONE, sar } from "../lib";

export interface PORow {
  id: string; po_no: string; po_date: string | null; expected_date: string | null; status: string;
  supplier: string | null; vehicles: number; received: number; value: number;
}

export default function PurchaseOrdersTable({ rows, canManage }: { rows: PORow[]; canManage: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string[]>([]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (status.length && !status.includes(r.status)) return false;
    if (q && ![r.po_no, r.supplier].filter(Boolean).join(" ").toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [rows, status, q]);

  async function del(r: PORow) {
    if (!confirm(`Delete ${r.po_no}?`)) return;
    const { error } = await supabase.rpc("car_po_delete", { p_id: r.id });
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search PO / supplier…" value={q} onChange={(e) => setQ(e.target.value)} />
        <MultiSelectFilter label="Status" options={Object.keys(PO_STATUS_LABEL).map((k) => ({ value: k, label: PO_STATUS_LABEL[k] }))} selected={status} onChange={setStatus} />
        <span className="ml-auto text-sm text-slate-500">{filtered.length} / {rows.length}</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[820px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">PO No</th><th className="th">Date</th><th className="th">Supplier</th>
              <th className="th text-right">Vehicles</th><th className="th text-right">Received</th>
              <th className="th text-right">Value</th><th className="th">Status</th><th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="td"><Link href={`/car-sales/purchases/${r.id}`} className="font-medium text-brand hover:underline">{r.po_no}</Link></td>
                <td className="td">{dateStr(r.po_date)}</td>
                <td className="td">{r.supplier ?? "—"}</td>
                <td className="td text-right">{r.vehicles}</td>
                <td className="td text-right">{r.received}/{r.vehicles}</td>
                <td className="td text-right tabular-nums">{sar(r.value)}</td>
                <td className="td"><span className={`badge ${PO_STATUS_TONE[r.status] ?? "bg-slate-100"}`}>{PO_STATUS_LABEL[r.status] ?? r.status}</span></td>
                <td className="td text-right">
                  <RowMenu items={[
                    { label: "Open", onClick: () => router.push(`/car-sales/purchases/${r.id}`) },
                    ...(canManage && r.status !== "received" ? [{ label: "Edit", onClick: () => router.push(`/car-sales/purchases/${r.id}/edit`) }] : []),
                    ...(canManage && r.received === 0 ? [{ label: "Delete", onClick: () => del(r), danger: true }] : []),
                  ]} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No purchase orders.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
