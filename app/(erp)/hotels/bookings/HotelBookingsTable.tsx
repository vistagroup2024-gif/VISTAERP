"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import RowMenu, { RowMenuItem } from "@/components/RowMenu";
import { dateStr } from "@/lib/format";
import {
  VENDOR_STATUS_LABEL, VENDOR_STATUS_TONE,
  PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE,
} from "../lib";

// Vendor flow shown on the main list. Once "vendor_confirmed" the booking is
// complete here — HCN handling moves to Check-in / Arrivals.
const MAIN_FLOW = ["pending_purchase", "sent_to_vendor", "vendor_confirmed"];
const CONFIRMED = new Set(["vendor_confirmed", "hcn_pending", "hcn_received"]);
function nextVendor(cur: string): string | null {
  if (cur === "pending_purchase") return "sent_to_vendor";
  if (cur === "sent_to_vendor" || cur === "vendor_processing") return "vendor_confirmed";
  return null;
}

// One row = one stay (leg) of a booking.
export interface HRow {
  id: string; stay_id: string; stay_index: number; stay_count: number;
  booking_no: string; booking_date: string; guest_name: string; group_no: string | null; guests: number | null;
  agent: string | null; city: string | null; hotel: string | null; check_in: string | null; check_out: string | null;
  nights: number; rooms: number; room_type: string | null; meal_plan: string | null; supplier: string | null;
  status: string; vendor_status: string; hcn_status: string; hcn: string | null;
  vendor_payment: string; customer_payment: string;
}

const isRealStay = (r: HRow) => !r.stay_id.startsWith(r.id + "-");

// Customer payment: pending within 2 days of check-in is highlighted red.
function custPayTone(r: HRow, today: string): string {
  if (r.customer_payment === "pending" && r.check_in) {
    const d = Math.round((new Date(r.check_in + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000);
    if (d <= 2) return "bg-red-100 text-red-700";
  }
  return PAYMENT_STATUS_TONE[r.customer_payment] ?? "bg-slate-100";
}

function headlineStatus(r: HRow): { label: string; tone: string } {
  if (r.status === "cancelled") return { label: "Cancelled", tone: "bg-red-100 text-red-700" };
  if (r.status === "completed" || CONFIRMED.has(r.vendor_status)) return { label: "Booking Completed", tone: "bg-green-100 text-green-700" };
  return { label: VENDOR_STATUS_LABEL[r.vendor_status] ?? r.vendor_status, tone: VENDOR_STATUS_TONE[r.vendor_status] ?? "bg-slate-100" };
}

export default function HotelBookingsTable({ rows }: { rows: HRow[] }) {
  const router = useRouter();
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [city, setCity] = useState<string[]>([]);
  const [agent, setAgent] = useState<string[]>([]);
  const [supplier, setSupplier] = useState<string[]>([]);
  const [payment, setPayment] = useState<string[]>([]);

  const agents = useMemo(() => Array.from(new Set(rows.map((r) => r.agent).filter(Boolean))) as string[], [rows]);
  const cities = useMemo(() => Array.from(new Set(rows.map((r) => r.city).filter(Boolean))) as string[], [rows]);
  const suppliers = useMemo(() => Array.from(new Set(rows.map((r) => r.supplier).filter(Boolean))) as string[], [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    const hs = headlineStatus(r);
    if (status.length && !status.includes(hs.label)) return false;
    if (city.length && !city.includes(r.city ?? "")) return false;
    if (agent.length && !agent.includes(r.agent ?? "")) return false;
    if (supplier.length && !supplier.includes(r.supplier ?? "")) return false;
    if (payment.length && !payment.includes(r.customer_payment)) return false;
    if (q) {
      const s = q.toLowerCase();
      const hay = [r.booking_no, r.guest_name, r.group_no, r.agent, r.hotel, r.hcn, r.supplier].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }), [rows, status, city, agent, supplier, payment, q]);

  const statusOptions = useMemo(() => {
    const set = new Map<string, string>();
    rows.forEach((r) => { const h = headlineStatus(r); set.set(h.label, h.label); });
    return Array.from(set.keys()).map((k) => ({ value: k, label: k }));
  }, [rows]);

  async function rpc(fn: string, args: any) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    router.refresh();
    return true;
  }

  function rowActions(r: HRow): RowMenuItem[] {
    const items: RowMenuItem[] = [
      { label: "Open", onClick: () => router.push(`/hotels/bookings/${r.id}`) },
      { label: "Edit", onClick: () => router.push(`/hotels/bookings/${r.id}/edit`) },
      { label: "Voucher", onClick: () => router.push(`/hotels/bookings/${r.id}/voucher`) },
    ];
    if (r.status === "cancelled" || !isRealStay(r)) return items;
    const nx = nextVendor(r.vendor_status);
    if (nx) items.unshift({ label: `▶ Mark ${VENDOR_STATUS_LABEL[nx]}`, onClick: () => rpc("hotel_purchase_set_vendor_status", { p_id: r.stay_id, p_status: nx, p_note: null }) });
    else items.push({ label: "Manage HCN (Check-in)", onClick: () => router.push(`/hotels/checkin`) });
    return items;
  }

  return (
    <div className="space-y-3">
      {err && <div className="rounded bg-slate-800 px-3 py-2 text-sm text-white">{err}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search booking, guest, group, hotel…" value={q} onChange={(e) => setQ(e.target.value)} />
        <MultiSelectFilter label="Status" options={statusOptions} selected={status} onChange={setStatus} />
        <MultiSelectFilter label="City" options={cities.map((c) => ({ value: c, label: c }))} selected={city} onChange={setCity} />
        {suppliers.length > 0 && <MultiSelectFilter label="Supplier" options={suppliers.map((s) => ({ value: s, label: s }))} selected={supplier} onChange={setSupplier} />}
        {agents.length > 0 && <MultiSelectFilter label="Agent" options={agents.map((a) => ({ value: a, label: a }))} selected={agent} onChange={setAgent} />}
        <MultiSelectFilter label="Cust. Payment" options={["pending", "partial", "rcvd"].map((s) => ({ value: s, label: PAYMENT_STATUS_LABEL[s] }))} selected={payment} onChange={setPayment} />
        <span className="ml-auto text-sm text-slate-500">{filtered.length} / {rows.length}</span>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1040px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Guest Name</th><th className="th">Agent</th><th className="th">Hotel</th>
              <th className="th">Check-in</th><th className="th">Check-out</th><th className="th">Nights</th>
              <th className="th">Rooms</th><th className="th">Supplier</th><th className="th">Payment</th><th className="th">Status</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const hs = headlineStatus(r);
              return (
                <tr key={r.stay_id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="td">
                    <Link href={`/hotels/bookings/${r.id}`} className="font-medium text-brand hover:underline">{r.guest_name}</Link>
                    <div className="text-xs text-slate-400">{r.booking_no}{r.group_no ? ` · ${r.group_no}` : ""}{r.stay_count > 1 ? ` · Stay ${r.stay_index + 1}/${r.stay_count}` : ""}</div>
                  </td>
                  <td className="td">{r.agent ?? "—"}</td>
                  <td className="td">{r.hotel ?? "—"}<div className="text-xs text-slate-400 capitalize">{r.city ?? ""}</div></td>
                  <td className="td">{dateStr(r.check_in)}</td>
                  <td className="td">{dateStr(r.check_out)}</td>
                  <td className="td">{r.nights || "—"}</td>
                  <td className="td">{r.rooms}</td>
                  <td className="td">{r.supplier ?? "—"}</td>
                  <td className="td">
                    <div className="flex flex-col gap-1">
                      <span className={`badge ${custPayTone(r, today)}`}>Cust: {PAYMENT_STATUS_LABEL[r.customer_payment] ?? r.customer_payment}</span>
                      <span className={`badge ${PAYMENT_STATUS_TONE[r.vendor_payment] ?? "bg-slate-100"}`}>Vndr: {PAYMENT_STATUS_LABEL[r.vendor_payment] ?? r.vendor_payment}</span>
                    </div>
                  </td>
                  <td className="td"><span className={`badge ${hs.tone}`}>{hs.label}</span></td>
                  <td className="td text-right"><RowMenu items={rowActions(r)} /></td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={11}>No bookings match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
