"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Row actions for a pending arrival: pick Transport/Tafweej, create the transport
// booking (Nusuk-prefilled so it auto-links to the group), or mark Tafweej done.
export default function ArrivalActions({ groupId, groupNo, pax, choice }: {
  groupId: string; groupNo: string | null; pax: number | null; choice: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function call(fn: string, args: any) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {err && <span className="text-xs text-red-600">{err}</span>}
      {(["transport", "tafweej"] as const).map((opt) => (
        <button key={opt} disabled={busy} title={`Mark this group's arrival choice as ${opt}`}
          onClick={() => call("set_group_arrival_service", { p_group: groupId, p_option: opt })}
          className={`rounded-full border px-2.5 py-1 text-xs ${choice === opt ? "border-brand bg-brand/10 text-brand" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
          {opt === "transport" ? "Transport" : "Tafweej"}
        </button>
      ))}
      <Link href={`/transport/bookings/new?nusuk=${encodeURIComponent(groupNo ?? "")}&pax=${pax ?? ""}`}
        className="rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90">Create Booking →</Link>
      <button disabled={busy} onClick={() => call("mark_group_tafweej", { p_group: groupId, p_done: true })}
        className="btn-outline text-xs">Mark Tafweej</button>
    </div>
  );
}
