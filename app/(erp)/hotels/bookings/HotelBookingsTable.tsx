"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import RowMenu, { RowMenuItem } from "@/components/RowMenu";
import { dateStr } from "@/lib/format";
import {
  HOTEL_STATUS_LABEL, VENDOR_STATUS_LABEL, VENDOR_STATUS_TONE,
  HCN_STAGE_LABEL, HCN_STAGE_TONE, buildHcnCopyText,
} from "../lib";

// HCN workflow stages surfaced in the filter.
const HCN_STAGES = ["pending", "ready_to_send", "sent"];
const VENDOR_STAGES = ["pending_purchase", "sent_to_vendor", "vendor_processing", "vendor_confirmed", "hcn_pending", "hcn_received"];

// One row = one stay (leg) of a booking.
export interface HRow {
  id: string; stay_id: string; stay_index: number; stay_count: number;
  booking_no: string; booking_date: string; guest_name: string; group_no: string | null; guests: number | null;
  agent: string | null; city: string | null; hotel: string | null; check_in: string | null; check_out: string | null;
  nights: number; rooms: number; room_type: string | null; meal_plan: string | null; supplier: string | null;
  status: string; vendor_status: string; hcn_status: string; hcn: string | null; payment: string;
}

const isPending = (s: string) => s === "pending";
const isReady = (s: string) => s === "ready_to_send" || s === "received";
const isSent = (s: string) => s === "sent" || s === "shared";
const isRealStay = (r: HRow) => !r.stay_id.startsWith(r.id + "-");

// Payment: pending within 2 days of check-in is highlighted red.
function paymentTone(r: HRow, today: string): string {
  if (r.payment === "billed") return "bg-green-100 text-green-700";
  if (r.check_in) {
    const d = Math.round((new Date(r.check_in + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000);
    if (d <= 2) return "bg-red-100 text-red-700";
  }
  return "bg-amber-100 text-amber-700";
}

export default function HotelBookingsTable({ rows }: { rows: HRow[] }) {
  const router = useRouter();
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hcnModal, setHcnModal] = useState<{ stayId: string; guest: string; hotel: string | null; value: string } | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [city, setCity] = useState<string[]>([]);
  const [hcn, setHcn] = useState<string[]>([]);
  const [agent, setAgent] = useState<string[]>([]);
  const [supplier, setSupplier] = useState<string[]>([]);
  const [payment, setPayment] = useState<string[]>([]);

  const agents = useMemo(() => Array.from(new Set(rows.map((r) => r.agent).filter(Boolean))) as string[], [rows]);
  const cities = useMemo(() => Array.from(new Set(rows.map((r) => r.city).filter(Boolean))) as string[], [rows]);
  const suppliers = useMemo(() => Array.from(new Set(rows.map((r) => r.supplier).filter(Boolean))) as string[], [rows]);

  const paymentState = (r: HRow) => (r.payment === "billed" ? "paid" : "pending");

  const filtered = useMemo(() => rows.filter((r) => {
    if (status.length && !status.includes(r.vendor_status)) return false;
    if (city.length && !city.includes(r.city ?? "")) return false;
    if (hcn.length && !hcn.includes(r.hcn_status === "received" ? "ready_to_send" : r.hcn_status === "shared" ? "sent" : r.hcn_status)) return false;
    if (agent.length && !agent.includes(r.agent ?? "")) return false;
    if (supplier.length && !supplier.includes(r.supplier ?? "")) return false;
    if (payment.length && !payment.includes(paymentState(r))) return false;
    if (q) {
      const s = q.toLowerCase();
      const hay = [r.booking_no, r.guest_name, r.group_no, r.agent, r.hotel, r.hcn, r.supplier].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }), [rows, status, city, hcn, agent, supplier, payment, q]);

  async function rpc(fn: string, args: any) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    router.refresh();
    return true;
  }

  async function copyStay(r: HRow) {
    const text = buildHcnCopyText(
      { guest_name: r.guest_name, booking_no: r.booking_no, group_no: r.group_no, guests: r.guests },
      [{ hotel: r.hotel, check_in: r.check_in, check_out: r.check_out, hcn: r.hcn }],
    );
    try { await navigator.clipboard.writeText(text); setErr("HCN details copied to clipboard."); } catch { setErr("Could not copy — clipboard blocked."); }
  }

  function rowActions(r: HRow): RowMenuItem[] {
    const items: RowMenuItem[] = [
      { label: "Open", onClick: () => router.push(`/hotels/bookings/${r.id}`) },
      { label: "Edit", onClick: () => router.push(`/hotels/bookings/${r.id}/edit`) },
      { label: "Voucher", onClick: () => router.push(`/hotels/bookings/${r.id}/voucher`) },
    ];
    if (r.status === "cancelled" || !isRealStay(r)) return items;
    const st = r.hcn_status;
    if (isPending(st)) {
      items.push({ label: "Received HCN", onClick: () => setHcnModal({ stayId: r.stay_id, guest: r.guest_name, hotel: r.hotel, value: r.hcn ?? "" }) });
    } else if (isReady(st)) {
      items.push({ label: "HCN Sent", onClick: () => rpc("hotel_hcn_mark_sent", { p_id: r.stay_id }) });
      items.push({ label: "Edit HCN", onClick: () => setHcnModal({ stayId: r.stay_id, guest: r.guest_name, hotel: r.hotel, value: r.hcn ?? "" }) });
      items.push({ label: "Copy HCN", onClick: () => copyStay(r) });
    } else if (isSent(st)) {
      items.push({ label: "Copy HCN", onClick: () => copyStay(r) });
    }
    return items;
  }

  const hcnStageOf = (s: string) => (s === "received" ? "ready_to_send" : s === "shared" ? "sent" : s);

  return (
    <div className="space-y-3">
      {err && <div className="rounded bg-slate-800 px-3 py-2 text-sm text-white">{err}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search booking, guest, group, hotel, HCN…" value={q} onChange={(e) => setQ(e.target.value)} />
        <MultiSelectFilter label="Status" options={VENDOR_STAGES.map((k) => ({ value: k, label: VENDOR_STATUS_LABEL[k] }))} selected={status} onChange={setStatus} />
        <MultiSelectFilter label="HCN" options={HCN_STAGES.map((k) => ({ value: k, label: HCN_STAGE_LABEL[k] }))} selected={hcn} onChange={setHcn} />
        <MultiSelectFilter label="City" options={cities.map((c) => ({ value: c, label: c }))} selected={city} onChange={setCity} />
        {suppliers.length > 0 && <MultiSelectFilter label="Supplier" options={suppliers.map((s) => ({ value: s, label: s }))} selected={supplier} onChange={setSupplier} />}
        {agents.length > 0 && <MultiSelectFilter label="Agent" options={agents.map((a) => ({ value: a, label: a }))} selected={agent} onChange={setAgent} />}
        <MultiSelectFilter label="Payment" options={[{ value: "pending", label: "Pending" }, { value: "paid", label: "Paid" }]} selected={payment} onChange={setPayment} />
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
            {filtered.map((r) => (
              <tr key={r.stay_id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="td">
                  <Link href={`/hotels/bookings/${r.id}`} className="font-medium text-brand hover:underline">{r.guest_name}</Link>
                  <div className="text-xs text-slate-400">{r.booking_no}{r.group_no ? ` · ${r.group_no}` : ""}{r.stay_count > 1 ? ` · Stay ${r.stay_index + 1}/${r.stay_count}` : ""}</div>
                </td>
                <td className="td">{r.agent ?? "—"}</td>
                <td className="td">{r.hotel ?? "—"}<div className="text-xs text-slate-400 capitalize">{[r.city, r.room_type, r.meal_plan].filter(Boolean).join(" · ")}</div></td>
                <td className="td">{dateStr(r.check_in)}</td>
                <td className="td">{dateStr(r.check_out)}</td>
                <td className="td">{r.nights || "—"}</td>
                <td className="td">{r.rooms}</td>
                <td className="td">{r.supplier ?? "—"}</td>
                <td className="td"><span className={`badge ${paymentTone(r, today)}`}>{r.payment === "billed" ? "Paid" : "Pending"}</span></td>
                <td className="td">
                  {r.status === "cancelled" || r.status === "completed"
                    ? <span className={`badge ${r.status === "cancelled" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{HOTEL_STATUS_LABEL[r.status] ?? r.status}</span>
                    : <>
                        <span className={`badge ${VENDOR_STATUS_TONE[r.vendor_status] ?? "bg-slate-100"}`}>{VENDOR_STATUS_LABEL[r.vendor_status] ?? r.vendor_status}</span>
                        {(r.vendor_status === "hcn_pending" || r.vendor_status === "hcn_received") &&
                          <div className="mt-0.5"><span className={`badge ${HCN_STAGE_TONE[hcnStageOf(r.hcn_status)] ?? "bg-slate-100"}`}>{HCN_STAGE_LABEL[hcnStageOf(r.hcn_status)] ?? r.hcn_status}</span></div>}
                      </>}
                </td>
                <td className="td text-right"><RowMenu items={rowActions(r)} /></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={11}>No bookings match.</td></tr>}
          </tbody>
        </table>
      </div>

      {hcnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setHcnModal(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-lg font-semibold">Enter HCN number</h3>
            <p className="mb-3 text-xs text-slate-500">{hcnModal.guest}{hcnModal.hotel ? ` · ${hcnModal.hotel}` : ""}</p>
            <input autoFocus className="input" value={hcnModal.value} placeholder="Hotel Confirmation Number"
              onChange={(e) => setHcnModal((m) => (m ? { ...m, value: e.target.value } : m))} />
            <div className="mt-4 flex gap-2">
              <button disabled={busy || !hcnModal.value.trim()} className="btn text-sm"
                onClick={async () => { const ok = await rpc("hotel_hcn_set_number", { p_id: hcnModal.stayId, p_hcn: hcnModal.value.trim() }); if (ok) setHcnModal(null); }}>
                Save &amp; mark Ready to Send
              </button>
              <button className="btn-outline text-sm" onClick={() => setHcnModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
