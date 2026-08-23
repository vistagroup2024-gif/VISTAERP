"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import RowMenu, { RowMenuItem } from "@/components/RowMenu";

const LABEL: Record<string, string> = {
  draft: "Draft", pending: "Pending", confirmed: "Confirmed", assigned: "Assigned",
  on_route: "On Route", picked_up: "Picked Up", completed: "Completed", cancelled: "Cancelled",
};
const COLOR: Record<string, string> = {
  draft: "bg-slate-200 text-slate-600", pending: "bg-amber-100 text-amber-700", confirmed: "bg-blue-100 text-blue-700",
  assigned: "bg-indigo-100 text-indigo-700", on_route: "bg-cyan-100 text-cyan-700", picked_up: "bg-teal-100 text-teal-700",
  completed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700",
};

export interface ARow {
  id: string; booking_no: string | null; passenger_name: string | null; booking_type: string | null;
  booking_date: string | null; total_amount: number | null; currency: string | null; status: string;
  cancel_requested?: boolean | null;
}

export default function AgentTransportTable({ rows, token, canRequest }: { rows: ARow[]; token: string; canRequest: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [q, setQ] = useState("");
  const [type, setType] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const types = useMemo(() => Array.from(new Set(rows.map((r) => r.booking_type).filter(Boolean))) as string[], [rows]);
  const statuses = useMemo(() => Array.from(new Set(rows.map((r) => r.status).filter(Boolean))) as string[], [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (type.length && !type.includes(r.booking_type ?? "")) return false;
    if (status.length && !status.includes(r.status)) return false;
    if (q) {
      const s = q.toLowerCase();
      const hay = [r.booking_no, r.passenger_name, r.booking_type, r.booking_date].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }), [rows, type, status, q]);

  async function requestCancel(r: ARow) {
    const reason = window.prompt(`Request cancellation of booking ${r.booking_no ?? ""}?\nOptionally add a reason:`, "");
    if (reason === null) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("b2b_transport_request_cancel", { p_token: token, p_id: r.id, p_reason: reason || null });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.refresh();
  }

  async function withdrawCancel(r: ARow) {
    if (!window.confirm(`Withdraw the cancellation request for booking ${r.booking_no ?? ""}?`)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("b2b_transport_withdraw_cancel", { p_token: token, p_id: r.id });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.refresh();
  }

  function actions(r: ARow): RowMenuItem[] {
    const items: RowMenuItem[] = [
      { label: "View", onClick: () => router.push(`/agent/module/transport/${r.id}`) },
      { label: "Vista Voucher", onClick: () => window.open(`/agent/module/transport/${r.id}/voucher?brand=vista`, "_blank") },
      { label: "Agent Voucher", onClick: () => window.open(`/agent/module/transport/${r.id}/voucher?brand=agent`, "_blank") },
    ];
    if (canRequest && !["cancelled", "completed"].includes(r.status)) {
      if (r.cancel_requested) items.push({ label: "Withdraw cancel request", onClick: () => withdrawCancel(r) });
      else items.push({ label: "Request Cancellation", onClick: () => requestCancel(r) });
    }
    return items;
  }

  return (
    <div className="space-y-3">
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search booking, haji, date…" value={q} onChange={(e) => setQ(e.target.value)} />
        {types.length > 0 && <MultiSelectFilter label="Type" options={types.map((t) => ({ value: t, label: t }))} selected={type} onChange={setType} />}
        <MultiSelectFilter label="Status" options={statuses.map((s) => ({ value: s, label: LABEL[s] ?? s }))} selected={status} onChange={setStatus} />
        <span className="ml-auto text-sm text-slate-500">{filtered.length} / {rows.length}</span>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Date</th><th className="th">Booking #</th><th className="th">Haji Name</th>
              <th className="th">Type</th><th className="th text-right">Total Amount</th><th className="th">Status</th><th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="td">{dateStr(r.booking_date)}</td>
                <td className="td font-medium"><Link href={`/agent/module/transport/${r.id}`} className="text-brand hover:underline">{r.booking_no ?? "—"}</Link></td>
                <td className="td">{r.passenger_name ?? "—"}</td>
                <td className="td capitalize">{r.booking_type}</td>
                <td className="td text-right tabular-nums">{Number(r.total_amount ?? 0).toFixed(2)} {r.currency}</td>
                <td className="td">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR[r.status] ?? "bg-slate-200"}`}>{LABEL[r.status] ?? r.status}</span>
                  {r.cancel_requested && r.status !== "cancelled" && <span className="ml-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">cancel requested</span>}
                </td>
                <td className="td text-right"><RowMenu items={actions(r)} /></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No transport bookings match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
