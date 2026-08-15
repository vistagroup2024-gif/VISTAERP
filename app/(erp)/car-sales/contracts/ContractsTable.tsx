"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import RowMenu from "@/components/RowMenu";
import { CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, sar } from "../lib";

export interface ContractRow {
  id: string; contract_no: string; contract_date: string | null; status: string;
  customer: string | null; vehicle: string; plate: string | null;
  sale_price: number; advance: number; paid: number; outstanding: number; overdue: number; next_due: string | null;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-slate-800"}`}>{value}</div>
    </div>
  );
}

export default function ContractsTable({ rows, canManage }: { rows: ContractRow[]; canManage: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string[]>([]);

  const totals = {
    active: rows.filter((r) => r.status === "active").length,
    completed: rows.filter((r) => r.status === "completed").length,
    outstanding: rows.filter((r) => r.status !== "cancelled").reduce((a, r) => a + r.outstanding, 0),
    overdue: rows.filter((r) => r.status !== "cancelled").reduce((a, r) => a + r.overdue, 0),
  };

  const filtered = useMemo(() => rows.filter((r) => {
    if (status.length && !status.includes(r.status)) return false;
    if (q && ![r.contract_no, r.customer, r.vehicle, r.plate].filter(Boolean).join(" ").toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [rows, status, q]);

  async function del(r: ContractRow) {
    if (!confirm(`Delete draft contract ${r.contract_no}?`)) return;
    const { error } = await supabase.rpc("car_contract_delete", { p_id: r.id });
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active" value={totals.active} tone="text-blue-700" />
        <Stat label="Completed" value={totals.completed} tone="text-emerald-700" />
        <Stat label="Outstanding" value={sar(totals.outstanding)} />
        <Stat label="Overdue" value={sar(totals.overdue)} tone="text-red-600" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search contract / customer / vehicle…" value={q} onChange={(e) => setQ(e.target.value)} />
        <MultiSelectFilter label="Status" options={Object.keys(CONTRACT_STATUS_LABEL).map((k) => ({ value: k, label: CONTRACT_STATUS_LABEL[k] }))} selected={status} onChange={setStatus} />
        <span className="ml-auto text-sm text-slate-500">{filtered.length} / {rows.length}</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[980px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Contract</th><th className="th">Customer</th><th className="th">Vehicle</th>
            <th className="th text-right">Sale Price</th><th className="th text-right">Advance</th>
            <th className="th text-right">Paid</th><th className="th text-right">Outstanding</th>
            <th className="th text-right">Overdue</th><th className="th">Next Due</th><th className="th">Status</th><th className="th text-right">Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="td"><Link href={`/car-sales/contracts/${r.id}`} className="font-medium text-brand hover:underline">{r.contract_no}</Link><div className="text-xs text-slate-400">{dateStr(r.contract_date)}</div></td>
                <td className="td">{r.customer ?? "—"}</td>
                <td className="td">{r.vehicle}<div className="text-xs text-slate-400">{r.plate ?? ""}</div></td>
                <td className="td text-right tabular-nums">{sar(r.sale_price)}</td>
                <td className="td text-right tabular-nums">{sar(r.advance)}</td>
                <td className="td text-right tabular-nums">{sar(r.paid)}</td>
                <td className="td text-right tabular-nums font-medium">{sar(r.outstanding)}</td>
                <td className="td text-right tabular-nums">{r.overdue > 0 ? <span className="text-red-600">{sar(r.overdue)}</span> : "—"}</td>
                <td className="td">{dateStr(r.next_due)}</td>
                <td className="td"><span className={`badge ${CONTRACT_STATUS_TONE[r.status] ?? "bg-slate-100"}`}>{CONTRACT_STATUS_LABEL[r.status] ?? r.status}</span></td>
                <td className="td text-right">
                  <RowMenu items={[
                    { label: "Open", onClick: () => router.push(`/car-sales/contracts/${r.id}`) },
                    ...(canManage && r.status === "draft" ? [
                      { label: "Edit", onClick: () => router.push(`/car-sales/contracts/${r.id}/edit`) },
                      { label: "Delete", onClick: () => del(r), danger: true },
                    ] : []),
                  ]} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={11}>No contracts.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
