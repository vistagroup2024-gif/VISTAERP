"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Staff control for a Visa Group's mandatory arrival service. Completion is
// derived: 'transport' once a booking exists, 'tafweej' once Vista records it.
export default function ArrivalServicePanel({
  groupId, groupNo, pax, state, choice, tafweejAt,
}: {
  groupId: string; groupNo: string | null; pax: number | null;
  state: string; choice: string | null; tafweejAt: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const done = state === "transport" || state === "tafweej";

  async function call(fn: string, args: any) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.refresh();
  }

  return (
    <div className={`card border-l-4 ${done ? "border-green-400" : "border-amber-400"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-800">Arrival Service</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${done ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
          {state === "transport" ? "✓ Transport booked" : state === "tafweej" ? "✓ Tafweej created" : "Pending"}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Every arriving group must be handled by Transport or Tafweej. This clears automatically once a transport booking exists or Tafweej is recorded.
      </p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}

      {!done && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">Choice:</span>
          {(["transport", "tafweej"] as const).map((opt) => (
            <button key={opt} disabled={busy} onClick={() => call("set_group_arrival_service", { p_group: groupId, p_option: opt })}
              className={`rounded-full border px-3 py-1 text-sm ${choice === opt ? "border-brand bg-brand/10 text-brand" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              {opt === "transport" ? "Transport by Vista" : "Tafweej by Vista"}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <Link href={`/transport/bookings/new?nusuk=${encodeURIComponent(groupNo ?? "")}&pax=${pax ?? ""}`} className="rounded bg-brand px-3 py-1 text-sm font-medium text-white hover:opacity-90">Create Transport Booking →</Link>
          <button disabled={busy} onClick={() => call("mark_group_tafweej", { p_group: groupId, p_done: true })} className="btn-outline text-sm">Mark Tafweej Created</button>
        </div>
      )}
      {state === "tafweej" && (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-sm text-slate-600">Tafweej recorded{tafweejAt ? ` on ${new Date(tafweejAt).toLocaleDateString()}` : ""}.</span>
          <button disabled={busy} onClick={() => call("mark_group_tafweej", { p_group: groupId, p_done: false })} className="text-sm text-slate-400 hover:underline">Undo</button>
        </div>
      )}
    </div>
  );
}
