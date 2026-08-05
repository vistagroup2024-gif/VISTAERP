"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function InvoiceCheck({ tripId, done, isAdmin }: { tripId: string; done: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(done);

  // Ticking is one-way for regular staff; only an admin can untick (with confirm).
  const locked = checked && !isAdmin;

  async function toggle() {
    if (locked) return;
    const next = !checked;
    if (!next && isAdmin && !confirm("Un-mark this invoice as created? This should only be done to correct a mistake.")) return;
    setBusy(true); setChecked(next);
    const { error } = await supabase.rpc("transport_set_invoice_created", { p_trip: tripId, p_done: next });
    setBusy(false);
    if (error) { setChecked(!next); alert(error.message); return; }
    router.refresh();
  }

  return (
    <label className={`inline-flex items-center gap-1.5 ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
      title={locked ? "Only an admin can un-mark this" : undefined}>
      <input type="checkbox" checked={checked} disabled={busy || locked} onChange={toggle} className="h-4 w-4 accent-brand" />
      <span className={`text-xs ${checked ? "text-green-700" : "text-amber-600"}`}>{checked ? "Created" : "Pending"}</span>
      {locked && <span className="text-slate-300">🔒</span>}
    </label>
  );
}
