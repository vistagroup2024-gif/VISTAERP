"use client";

import { useState } from "react";
import Link from "next/link";

interface Row {
  id: string; booking_no: string | null; booking_type: string; status: string;
  passenger_name: string | null; mobile: string | null; pax: number | null; booking_date: string | null;
  total_amount: number; currency: string; agent_name: string | null;
}

const LABEL: Record<string, string> = {
  draft: "Draft", pending: "Pending", confirmed: "Confirmed", assigned: "Assigned",
  on_route: "On Route", picked_up: "Picked Up", completed: "Completed", cancelled: "Cancelled",
};
const COLOR: Record<string, string> = {
  draft: "bg-slate-200 text-slate-600", pending: "bg-amber-100 text-amber-700", confirmed: "bg-blue-100 text-blue-700",
  assigned: "bg-indigo-100 text-indigo-700", on_route: "bg-cyan-100 text-cyan-700", picked_up: "bg-teal-100 text-teal-700",
  completed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700",
};
const TYPE: Record<string, string> = { single: "Single", multiple: "Multiple", package: "Package" };

export default function BookingsTable({ initial }: { initial: Row[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const rows = initial.filter((r) => {
    if (status && r.status !== status) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return [r.booking_no, r.passenger_name, r.mobile, r.agent_name].some((x) => (x ?? "").toLowerCase().includes(s));
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search booking / passenger / mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="ml-auto self-center text-sm text-slate-500">{rows.length} booking(s)</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr><th className="th">Booking Date</th><th className="th">Agent</th><th className="th">Haji Name</th><th className="th">Pax</th><th className="th">Type</th><th className="th">Total Amount</th><th className="th">Status</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="td">{r.booking_date ?? "—"}</td>
                <td className="td">{r.agent_name ?? "—"}</td>
                <td className="td font-medium">
                  <Link href={`/transport/bookings/${r.id}`} className="text-brand hover:underline">{r.passenger_name ?? r.booking_no ?? "—"}</Link>
                  <div className="text-xs text-slate-400">{[r.booking_no, r.mobile].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="td">{r.pax ?? "—"}</td>
                <td className="td">{TYPE[r.booking_type] ?? r.booking_type}</td>
                <td className="td">{Number(r.total_amount).toFixed(2)} {r.currency}</td>
                <td className="td"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR[r.status] ?? "bg-slate-200"}`}>{LABEL[r.status] ?? r.status}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No bookings found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
