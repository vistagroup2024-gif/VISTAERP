"use client";

import { useEffect, useState } from "react";
import { setTripInvoiceCreated } from "./actions";

// Ticking is one-way for regular staff; only an admin can untick (with confirm).
export default function InvoiceCheck({ tripId, done, isAdmin }: { tripId: string; done: boolean; isAdmin: boolean }) {
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(done);
  const [err, setErr] = useState<string | null>(null);

  // The saved row is the truth. The tick shows immediately, but once the action
  // has revalidated the page this pulls the box back onto whatever was actually
  // stored — so a write that failed can never leave "Created" on screen.
  useEffect(() => { setChecked(done); }, [done]);

  const locked = checked && !isAdmin;

  async function toggle() {
    if (locked || busy) return;
    const next = !checked;
    if (!next && isAdmin && !confirm("Un-mark this invoice as created? This should only be done to correct a mistake.")) return;
    setErr(null);
    setBusy(true);
    setChecked(next);
    const { error } = await setTripInvoiceCreated(tripId, next);
    setBusy(false);
    if (error) { setChecked(!next); setErr(error); }
  }

  return (
    <label className={`inline-flex items-center gap-1.5 ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
      title={err ?? (locked ? "Only an admin can un-mark this" : undefined)}>
      <input type="checkbox" checked={checked} disabled={busy || locked} onChange={toggle} className="h-4 w-4 accent-brand" />
      <span className={`text-xs ${checked ? "text-green-700" : "text-amber-600"}`}>{checked ? "Created" : "Pending"}</span>
      {locked && <span className="text-slate-300">🔒</span>}
      {err && <span className="text-xs text-red-600">{err}</span>}
    </label>
  );
}
