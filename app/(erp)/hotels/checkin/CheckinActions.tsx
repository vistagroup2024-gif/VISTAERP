"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import RowMenu, { RowMenuItem } from "@/components/RowMenu";
import { buildHcnCopyText } from "../lib";

export interface CheckinStay {
  id: string; hcn_status: string; hcn: string | null; hotel: string | null;
  check_in: string | null; check_out: string | null;
}
export interface CheckinBooking {
  id: string; guest_name: string; booking_no: string; group_no: string | null; guests: number | null;
}

const isPending = (s: string) => s === "pending";
const isReady = (s: string) => s === "ready_to_send" || s === "received";
const isSent = (s: string) => s === "sent" || s === "shared";

export default function CheckinActions({ booking, stays }: { booking: CheckinBooking; stays: CheckinStay[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<{ stayId: string; hotel: string | null; value: string } | null>(null);

  const multi = stays.length > 1;
  const tag = (s: CheckinStay) => (multi && s.hotel ? ` · ${s.hotel}` : "");

  async function rpc(fn: string, args: any) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    router.refresh();
    return true;
  }

  async function copyStay(s: CheckinStay) {
    const text = buildHcnCopyText(
      { guest_name: booking.guest_name, booking_no: booking.booking_no, group_no: booking.group_no, guests: booking.guests },
      [{ hotel: s.hotel, check_in: s.check_in, check_out: s.check_out, hcn: s.hcn }],
    );
    try { await navigator.clipboard.writeText(text); setErr("HCN details copied."); } catch { setErr("Could not copy — clipboard blocked."); }
  }

  const items: RowMenuItem[] = [
    { label: "Open booking", onClick: () => router.push(`/hotels/bookings/${booking.id}`) },
    { label: "Print Voucher", onClick: () => router.push(`/hotels/bookings/${booking.id}/voucher`) },
  ];
  for (const s of stays) {
    const st = s.hcn_status;
    if (isPending(st)) items.push({ label: `Enter HCN${tag(s)}`, onClick: () => setModal({ stayId: s.id, hotel: s.hotel, value: s.hcn ?? "" }) });
    else if (isReady(st)) {
      items.push({ label: `Mark HCN Sent${tag(s)}`, onClick: () => rpc("hotel_hcn_mark_sent", { p_id: s.id }) });
      items.push({ label: `Edit HCN${tag(s)}`, onClick: () => setModal({ stayId: s.id, hotel: s.hotel, value: s.hcn ?? "" }) });
      items.push({ label: `Copy HCN${tag(s)}`, onClick: () => copyStay(s) });
    } else if (isSent(st)) items.push({ label: `Copy HCN${tag(s)}`, onClick: () => copyStay(s) });
  }

  return (
    <>
      <RowMenu items={items} />
      {err && <div className="mt-1 text-[11px] text-slate-500">{err}</div>}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-lg font-semibold">Enter HCN number</h3>
            <p className="mb-3 text-xs text-slate-500">{booking.guest_name}{modal.hotel ? ` · ${modal.hotel}` : ""}</p>
            <input autoFocus className="input" value={modal.value} placeholder="Hotel Confirmation Number"
              onChange={(e) => setModal((m) => (m ? { ...m, value: e.target.value } : m))} />
            <div className="mt-4 flex gap-2">
              <button disabled={busy || !modal.value.trim()} className="btn text-sm"
                onClick={async () => { const ok = await rpc("hotel_hcn_set_number", { p_id: modal.stayId, p_hcn: modal.value.trim() }); if (ok) setModal(null); }}>
                Save &amp; mark Ready to Send
              </button>
              <button className="btn-outline text-sm" onClick={() => setModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
