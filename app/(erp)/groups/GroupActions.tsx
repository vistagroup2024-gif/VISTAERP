"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function GroupActions({
  groupId, brnStatus, visaStatus, isAdmin,
}: { groupId: string; brnStatus: string; visaStatus: string; isAdmin: boolean }) {
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

  // After visa issued: only Super Admin sees Edit; normal users see a lock.
  if (issued) {
    return isAdmin
      ? <Link href={`/groups/${groupId}/edit`} className="text-brand text-sm hover:underline">Edit</Link>
      : <span className="text-slate-400" title="Locked — visa issued">🔒</span>;
  }

  // Before visa issued: only Mark Visa Issued (allocation already done at this stage)
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={markIssued}
        disabled={busy || !allocated}
        title={allocated ? "" : "Allocate BRNs first (open the group)"}
        className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">
        {busy ? "…" : "Mark Visa Issued"}
      </button>
      {err && <span className="text-xs text-red-600" title={err}>⚠</span>}
    </div>
  );
}
