"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PrintButton from "@/components/PrintButton";
import VoucherDocument from "@/components/VoucherDocument";

interface TripBase {
  id: string; seq: number | null; route: string | null; trip_date: string | null; trip_time: string | null;
  pickup_location: string | null; drop_location: string | null; vehicle: string | null; hajj_terminal: boolean | null;
  fare: number | null; // current saved agent fare (agent_sell_rate)
}

// The agent enters their OWN selling fares per trip and prints an invoice-style voucher
// under their own branding. Fares are saved (agent_sell_rate) so they can reprint.
export default function AgentInvoiceVoucher({
  token, bookingId, provider, booking, tripsBase, qr, helpline, currency,
}: {
  token: string; bookingId: string; provider: any; booking: any; tripsBase: TripBase[]; qr: string;
  helpline: string | null; currency: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [fares, setFares] = useState<Record<string, string>>(
    Object.fromEntries(tripsBase.map((t) => [t.id, t.fare != null ? String(t.fare) : ""])),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const docTrips = useMemo(() => tripsBase.map((t) => ({
    seq: t.seq, route: t.route, trip_date: t.trip_date, trip_time: t.trip_time,
    pickup_location: t.pickup_location, drop_location: t.drop_location, vehicle: t.vehicle,
    hajj_terminal: t.hajj_terminal, fare: Number(fares[t.id]) || 0,
  })), [tripsBase, fares]);

  const total = docTrips.reduce((s, t) => s + (Number(t.fare) || 0), 0);
  // total_amount drives the voucher's grand total; override with the agent's own total.
  const docBooking = { ...booking, total_amount: total, discount: 0, sell_amount: null, additional_charges: 0, surcharge_amount: 0 };

  async function save() {
    setBusy(true); setMsg(null);
    const payload = tripsBase.map((t) => ({ id: t.id, fare: Number(fares[t.id]) || 0 }));
    const { error } = await supabase.rpc("b2b_transport_set_agent_fares", { p_token: token, p_id: bookingId, p_fares: payload });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setMsg("Saved. You can reprint anytime.");
    router.refresh();
  }

  return (
    <div>
      <div className="no-print mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 text-sm font-semibold text-slate-700">Your selling fares (for your invoice)</div>
        <div className="space-y-2">
          {tripsBase.map((t) => (
            <div key={t.id} className="flex items-center gap-3 text-sm">
              <span className="flex-1 text-slate-600">{t.seq}. {t.route ?? "Trip"}{t.trip_date ? ` · ${t.trip_date}` : ""}</span>
              <input type="number" min="0" step="0.01" className="input max-w-[9rem] text-right" value={fares[t.id] ?? ""}
                placeholder="0.00" onChange={(e) => setFares((f) => ({ ...f, [t.id]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-sm text-slate-500">Total: <b className="text-slate-800">{total.toLocaleString("en-US", { maximumFractionDigits: 2 })} {currency}</b></span>
          <div className="flex items-center gap-2">
            {msg && <span className="text-xs text-slate-500">{msg}</span>}
            <button disabled={busy} onClick={save} className="btn-outline text-sm">{busy ? "Saving…" : "Save fares"}</button>
            <PrintButton />
          </div>
        </div>
      </div>
      <VoucherDocument provider={provider} booking={docBooking} trips={docTrips} qr={qr} showFares helpline={helpline} />
    </div>
  );
}
