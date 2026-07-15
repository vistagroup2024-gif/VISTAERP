"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ReleaseButton({ consumptionId }: { consumptionId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function release() {
    const reason = prompt("Release this BRN consumption?\nBeds and availability will be restored for those nights.\n\nEnter a mandatory reason (recorded in the audit log):");
    if (reason === null) return;
    if (!reason.trim()) { alert("A reason is required."); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("release_consumption", { p_consumption: consumptionId, p_reason: reason.trim() });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={release} disabled={busy} className="text-sm text-red-600 hover:underline disabled:opacity-40">
        {busy ? "…" : "Release"}
      </button>
      {err && <span className="text-xs text-red-600" title={err}>⚠</span>}
    </span>
  );
}
