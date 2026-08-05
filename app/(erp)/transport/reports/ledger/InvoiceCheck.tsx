"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function InvoiceCheck({ tripId, done }: { tripId: string; done: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(done);

  async function toggle() {
    const next = !checked;
    setBusy(true); setChecked(next);
    const { error } = await supabase.rpc("transport_set_invoice_created", { p_trip: tripId, p_done: next });
    setBusy(false);
    if (error) { setChecked(!next); alert(error.message); return; }
    router.refresh();
  }

  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5">
      <input type="checkbox" checked={checked} disabled={busy} onChange={toggle} className="h-4 w-4 accent-brand" />
      <span className={`text-xs ${checked ? "text-green-700" : "text-amber-600"}`}>{checked ? "Created" : "Pending"}</span>
    </label>
  );
}
