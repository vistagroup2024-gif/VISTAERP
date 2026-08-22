"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AgentCancelRequest({ token, id, requested }: { token: string; id: string; requested: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(requested);
  const [err, setErr] = useState<string | null>(null);

  if (done) return <span className="rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-600">Cancellation requested</span>;

  async function request() {
    const reason = window.prompt("Request cancellation of this booking?\nOptionally add a reason:", "");
    if (reason === null) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("b2b_transport_request_cancel", { p_token: token, p_id: id, p_reason: reason || null });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(true); router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button disabled={busy} onClick={request} className="btn-outline text-sm text-red-600">Request Cancellation</button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
