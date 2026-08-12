"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import { dateStr } from "@/lib/format";
import { HOTEL_STATUS_LABEL, HOTEL_STATUS_TONE, HCN_STATUS_LABEL } from "../lib";

export interface HRow {
  id: string; booking_no: string; booking_date: string; guest_name: string; group_no: string | null;
  agent: string | null; city: string | null; hotel: string | null; check_in: string | null; check_out: string | null;
  nights: number; rooms: number; supplier: string | null; status: string; hcn_status: string; payment: string;
}

const PAYMENT_LABEL: Record<string, string> = { billed: "Billed", none: "Pending" };

export default function HotelBookingsTable({ rows }: { rows: HRow[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [city, setCity] = useState<string[]>([]);
  const [hcn, setHcn] = useState<string[]>([]);
  const [agent, setAgent] = useState<string[]>([]);

  const agents = useMemo(() => Array.from(new Set(rows.map((r) => r.agent).filter(Boolean))) as string[], [rows]);
  const cities = useMemo(() => Array.from(new Set(rows.map((r) => r.city).filter(Boolean))) as string[], [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (status.length && !status.includes(r.status)) return false;
    if (city.length && !city.includes(r.city ?? "")) return false;
    if (hcn.length && !hcn.includes(r.hcn_status)) return false;
    if (agent.length && !agent.includes(r.agent ?? "")) return false;
    if (q) {
      const s = q.toLowerCase();
      const hay = [r.booking_no, r.guest_name, r.group_no, r.agent, r.hotel].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }), [rows, status, city, hcn, agent, q]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search booking, guest, group, hotel…" value={q} onChange={(e) => setQ(e.target.value)} />
        <MultiSelectFilter label="Status" options={Object.keys(HOTEL_STATUS_LABEL).map((k) => ({ value: k, label: HOTEL_STATUS_LABEL[k] }))} selected={status} onChange={setStatus} />
        <MultiSelectFilter label="City" options={cities.map((c) => ({ value: c, label: c }))} selected={city} onChange={setCity} />
        <MultiSelectFilter label="HCN" options={Object.keys(HCN_STATUS_LABEL).map((k) => ({ value: k, label: HCN_STATUS_LABEL[k] }))} selected={hcn} onChange={setHcn} />
        {agents.length > 0 && <MultiSelectFilter label="Agent" options={agents.map((a) => ({ value: a, label: a }))} selected={agent} onChange={setAgent} />}
        <span className="ml-auto text-sm text-slate-500">{filtered.length} / {rows.length}</span>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Guest Name</th><th className="th">Agent</th><th className="th">Hotel</th>
              <th className="th">Check-in</th><th className="th">Check-out</th><th className="th">Nights</th>
              <th className="th">Rooms</th><th className="th">Supplier</th><th className="th">Payment</th><th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="td"><Link href={`/hotels/bookings/${r.id}`} className="font-medium text-brand hover:underline">{r.guest_name}</Link><div className="text-xs text-slate-400">{r.booking_no}{r.group_no ? ` · ${r.group_no}` : ""}</div></td>
                <td className="td">{r.agent ?? "—"}</td>
                <td className="td">{r.hotel ?? "—"}<div className="text-xs text-slate-400 capitalize">{r.city ?? ""}</div></td>
                <td className="td">{dateStr(r.check_in)}</td>
                <td className="td">{dateStr(r.check_out)}</td>
                <td className="td">{r.nights || "—"}</td>
                <td className="td">{r.rooms}</td>
                <td className="td">{r.supplier ?? "—"}</td>
                <td className="td"><span className={`badge ${r.payment === "billed" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{PAYMENT_LABEL[r.payment] ?? r.payment}</span></td>
                <td className="td"><span className={`badge ${HOTEL_STATUS_TONE[r.status] ?? "bg-slate-100"}`}>{HOTEL_STATUS_LABEL[r.status] ?? r.status}</span></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={10}>No bookings match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
