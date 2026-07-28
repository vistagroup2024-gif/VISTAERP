"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

interface Booking { id: string; booking_no: string | null; passenger_name: string | null; mobile: string | null; whatsapp: string | null; status: string }
type Rating = { rating: number; feedback: string | null } | null;

export default function BookingExtras({ booking, driverId, rating }: { booking: Booking; driverId: string | null; rating: Rating }) {
  const router = useRouter();
  const supabase = createClient();
  const [channel, setChannel] = useState("whatsapp");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stars, setStars] = useState<number>(rating?.rating ?? 0);
  const [fb, setFb] = useState(rating?.feedback ?? "");
  const [busy, setBusy] = useState(false);

  const defaultBody = `Dear ${booking.passenger_name ?? "Guest"}, your Vista Group transport booking ${booking.booking_no ?? ""} is confirmed. Our driver will contact you before pickup. Thank you.`;

  async function queue(send: boolean) {
    setBusy(true); setErr(null); setMsg(null);
    const to = channel === "whatsapp" ? (booking.whatsapp || booking.mobile) : booking.mobile;
    const { data, error } = await supabase.from("transport_outbox").insert({
      company_id: COMPANY_ID, booking_id: booking.id, channel, to_addr: to, body: defaultBody, status: "queued",
    }).select("id").single();
    if (error) { setBusy(false); return setErr(error.message); }

    if (send && channel === "whatsapp") {
      const res = await fetch("/api/transport/whatsapp/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: data.id }) });
      const json = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { setErr(json.error || "Send failed — message left in the outbox."); return; }
      setMsg(json.sent ? `Sent to ${to} via WhatsApp.` : `Not sent (${json.failed} failed) — see Confirmations outbox.`);
      router.refresh();
      return;
    }
    setBusy(false);
    setMsg(`Confirmation queued for ${to ?? "—"} via ${channel}. Open Confirmations to send.`);
  }

  async function saveRating() {
    if (!stars) return;
    setBusy(true); setErr(null); setMsg(null);
    const { error } = await supabase.from("transport_ratings").upsert(
      { company_id: COMPANY_ID, booking_id: booking.id, driver_id: driverId, rating: stars, feedback: fb.trim() || null },
      { onConflict: "booking_id" }
    );
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg("Rating saved."); router.refresh();
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="card space-y-2">
        <h2 className="font-semibold text-slate-700">📣 Send Confirmation</h2>
        <div className="flex items-center gap-2">
          <select className="input max-w-[10rem]" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option>
          </select>
          {channel === "whatsapp" && <button onClick={() => queue(true)} disabled={busy} className="btn text-sm">{busy ? "Sending…" : "Send now"}</button>}
          <button onClick={() => queue(false)} disabled={busy} className="btn-outline text-sm">Queue</button>
        </div>
        <p className="text-xs text-slate-500">{defaultBody}</p>
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold text-slate-700">⭐ Customer Rating</h2>
        <div className="flex gap-1 text-2xl">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setStars(n)} className={n <= stars ? "text-amber-400" : "text-slate-300"}>★</button>
          ))}
        </div>
        <textarea className="input" rows={2} placeholder="Feedback (optional)" value={fb} onChange={(e) => setFb(e.target.value)} />
        <button onClick={saveRating} disabled={busy || !stars} className="btn-outline text-sm">Save rating</button>
      </div>

      {(msg || err) && <p className={`lg:col-span-2 text-sm ${err ? "text-red-600" : "text-green-700"}`}>{err || msg}</p>}
    </div>
  );
}
