"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import RowMenu, { RowMenuItem } from "@/components/RowMenu";
import { dateStr } from "@/lib/format";
import { HOTEL_STATUS_LABEL, HOTEL_STATUS_TONE, HCN_STAGE_LABEL, HCN_STAGE_TONE, buildHcnCopyText } from "../lib";

// HCN workflow stages surfaced in the list Status column / filter.
const HCN_STAGES = ["pending", "ready_to_send", "sent"];

export interface HStay { id: string; hcn_status: string; hcn: string | null; hotel: string | null; check_in: string | null; check_out: string | null }
export interface HRow {
  id: string; booking_no: string; booking_date: string; guest_name: string; group_no: string | null; guests: number | null;
  agent: string | null; city: string | null; hotel: string | null; check_in: string | null; check_out: string | null;
  nights: number; rooms: number; supplier: string | null; status: string; hcn_status: string; payment: string;
  stays: HStay[];
}

const PAYMENT_LABEL: Record<string, string> = { billed: "Billed", none: "Pending" };
const isPending = (s: string) => s === "pending";
const isReady = (s: string) => s === "ready_to_send" || s === "received";
const isSent = (s: string) => s === "sent" || s === "shared";

export default function HotelBookingsTable({ rows }: { rows: HRow[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // HCN-number entry modal (Received HCN action). Targets one specific stay.
  const [hcnModal, setHcnModal] = useState<{ stayId: string; guest: string; hotel: string | null; value: string } | null>(null);
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

  async function rpc(fn: string, args: any) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    router.refresh();
    return true;
  }

  async function copyStay(r: HRow, stay: HStay) {
    const text = buildHcnCopyText(
      { guest_name: r.guest_name, booking_no: r.booking_no, group_no: r.group_no, guests: r.guests },
      [{ hotel: stay.hotel, check_in: stay.check_in, check_out: stay.check_out, hcn: stay.hcn }],
    );
    try { await navigator.clipboard.writeText(text); setErr("HCN details copied to clipboard."); } catch { setErr("Could not copy — clipboard blocked."); }
  }

  // Row actions depend on the booking's HCN workflow stage. For a single stay the
  // full workflow runs inline; multi-stay bookings route to the detail page where
  // each stay's HCN is managed separately.
  function rowActions(r: HRow): RowMenuItem[] {
    const items: RowMenuItem[] = [
      { label: "Open", onClick: () => router.push(`/hotels/bookings/${r.id}`) },
      { label: "Edit", onClick: () => router.push(`/hotels/bookings/${r.id}/edit`) },
      { label: "Voucher", onClick: () => router.push(`/hotels/bookings/${r.id}/voucher`) },
    ];
    if (r.status === "cancelled") return items;
    const single = r.stays.length === 1 ? r.stays[0] : null;
    if (single) {
      const st = single.hcn_status;
      if (isPending(st)) {
        items.push({ label: "Received HCN", onClick: () => setHcnModal({ stayId: single.id, guest: r.guest_name, hotel: single.hotel, value: single.hcn ?? "" }) });
      } else if (isReady(st)) {
        items.push({ label: "HCN Sent", onClick: () => rpc("hotel_hcn_mark_sent", { p_id: single.id }) });
        items.push({ label: "Edit HCN", onClick: () => setHcnModal({ stayId: single.id, guest: r.guest_name, hotel: single.hotel, value: single.hcn ?? "" }) });
        items.push({ label: "Copy HCN", onClick: () => copyStay(r, single) });
      } else if (isSent(st)) {
        items.push({ label: "Copy HCN", onClick: () => copyStay(r, single) });
      }
    } else if (r.stays.length > 1) {
      items.push({ label: `Manage HCN (${r.stays.length} stays)`, onClick: () => router.push(`/hotels/bookings/${r.id}`) });
    }
    return items;
  }

  return (
    <div className="space-y-3">
      {err && <div className="rounded bg-slate-800 px-3 py-2 text-sm text-white">{err}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search booking, guest, group, hotel…" value={q} onChange={(e) => setQ(e.target.value)} />
        <MultiSelectFilter label="Status" options={Object.keys(HOTEL_STATUS_LABEL).map((k) => ({ value: k, label: HOTEL_STATUS_LABEL[k] }))} selected={status} onChange={setStatus} />
        <MultiSelectFilter label="City" options={cities.map((c) => ({ value: c, label: c }))} selected={city} onChange={setCity} />
        <MultiSelectFilter label="HCN" options={HCN_STAGES.map((k) => ({ value: k, label: HCN_STAGE_LABEL[k] }))} selected={hcn} onChange={setHcn} />
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
              <th className="th text-right">Actions</th>
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
                <td className="td">
                  {r.status === "cancelled" || r.status === "completed"
                    ? <span className={`badge ${HOTEL_STATUS_TONE[r.status] ?? "bg-slate-100"}`}>{HOTEL_STATUS_LABEL[r.status] ?? r.status}</span>
                    : <span className={`badge ${HCN_STAGE_TONE[r.hcn_status] ?? "bg-slate-100"}`}>{HCN_STAGE_LABEL[r.hcn_status] ?? r.hcn_status}</span>}
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
