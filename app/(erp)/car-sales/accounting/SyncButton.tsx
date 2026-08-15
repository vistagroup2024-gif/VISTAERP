"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SyncButton() {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("car_accounting_sync");
    setBusy(false);
    if (error) return setMsg(error.message);
    setMsg(`Posted ${data ?? 0} new journal ${Number(data) === 1 ? "entry" : "entries"}.`);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <button className="btn" disabled={busy} onClick={sync}>{busy ? "Posting…" : "Sync to Accounting"}</button>
      {msg && <span className="text-sm text-slate-600">{msg}</span>}
    </div>
  );
}
