"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Mirrors the transport trip-ledger InvoiceCheck: ticking is one-way for staff,
// only an admin can untick (with confirm).
export default function VisaInvoiceCheck({ groupId, done, isAdmin }: { groupId: string; done: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(done);

  const locked = checked && !isAdmin;

  async function toggle() {
    if (locked) return;
    const next = !checked;
    if (!next && isAdmin && !confirm("Un-mark this invoice as created? This should only be done to correct a mistake.")) return;
    setBusy(true); setChecked(next);
    const { error } = await supabase.rpc("visa_set_invoice_created", { p_group: groupId, p_done: next });
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
