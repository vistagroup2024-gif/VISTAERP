"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function GroupActions({
  groupId, brnStatus, visaStatus,
}: { groupId: string; brnStatus: string; visaStatus: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const issued = visaStatus === "issued";
  const allocated = brnStatus === "allocated";

  async function markIssued() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("mark_visa_issued", { p_group: groupId });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Link href={`/groups/${groupId}`} className="text-brand hover:underline">View</Link>
      {!issued && <Link href={`/groups/${groupId}/edit`} className="text-slate-500 hover:underline">Edit</Link>}
      <Link href={`/groups/${groupId}`} className="text-slate-500 hover:underline">
        {allocated ? "BRNs" : "Allocate"}
      </Link>
      {allocated && !issued && (
        <button onClick={markIssued} disabled={busy}
          className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? "…" : "Mark Visa Issued"}
        </button>
      )}
      {err && <span className="text-xs text-red-600" title={err}>⚠</span>}
    </div>
  );
}
