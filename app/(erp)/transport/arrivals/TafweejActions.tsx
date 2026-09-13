"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TafweejCard, { type TafweejDetails } from "@/components/transport/TafweejCard";

// Row actions on the Transport-by-Vista list. The Tafweej is the AGENT's to
// create here — the visa is not Vista's — so what staff do is hand them the
// driver's details in the form the tafweej wants, and tick the trip off once
// the agent says it is done.
export default function TafweejActions({ tripId, ready, created }: { tripId: string; ready: boolean; created: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<TafweejDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function show() {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("transport_trip_tafweej", { p_trip: tripId });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setD(data as TafweejDetails); setOpen(true);
  }
  async function mark(val: boolean) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("transport_set_tafweej", { p_trip: tripId, p_val: val });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {err && <span className="text-xs text-red-600">{err}</span>}
      <button disabled={busy || !ready} onClick={show}
        title={ready ? "Show the driver details in the form the tafweej asks for" : "Assign a driver first"}
        className="rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">
        Driver Tafweej Details
      </button>
      {created
        ? <button disabled={busy} onClick={() => mark(false)} className="btn-outline text-xs" title="Undo">Tafweej created ✓</button>
        : <button disabled={busy} onClick={() => mark(true)} className="btn-outline text-xs">Mark Tafweej</button>}

      {open && d && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md">
            <TafweejCard d={d} title="Driver Tafweej Details" />
            <button onClick={() => setOpen(false)} className="mt-2 w-full rounded-lg bg-white px-3 py-2 text-sm text-slate-600 shadow-pop hover:bg-slate-50">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
