"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Shown to staff when an agent has requested a cancellation: approve (cancel the
// booking) or reject (keep it confirmed). Either way the request is cleared.
export default function CancelRequestBar({ id, reason }: { id: string; reason: string | null }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function act(fn: string, confirmMsg: string) {
    if (!window.confirm(confirmMsg)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, { p_id: id });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.refresh();
  }

  return (
    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-red-700">⚠ Cancellation requested by the agent</div>
          {reason && <div className="mt-0.5 text-sm text-red-600">Reason: {reason}</div>}
        </div>
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => act("transport_cancel_request_approve", "Approve cancellation? The booking and its open trips will be cancelled.")}
            className="btn bg-red-600 text-sm hover:bg-red-700">Confirm cancellation</button>
          <button disabled={busy} onClick={() => act("transport_cancel_request_reject", "Reject the cancellation request? The booking stays confirmed.")}
            className="btn-outline text-sm">Reject request</button>
        </div>
      </div>
      {err && <div className="mt-2 text-sm text-red-700">{err}</div>}
    </div>
  );
}
