"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Staged visa workflow: Pending -> BRN Allocated -> ERP Created -> Package Assigned -> Visa Issued.
// Only the next valid action is shown at each stage.
const NEXT: Record<string, { label: string; fn: string; args?: any; cls: string }> = {
  pending: { label: "Allocate BRN", fn: "allocate_group_brns", cls: "bg-brand" },
  brn_allocated: { label: "ERP Created", fn: "advance_workflow", args: { p_to: "erp_created" }, cls: "bg-indigo-600" },
  erp_created: { label: "Package Assigned", fn: "advance_workflow", args: { p_to: "package_assigned" }, cls: "bg-violet-600" },
  package_assigned: { label: "Visa Issued", fn: "mark_visa_issued", cls: "bg-emerald-600" },
};

export default function GroupActions({
  groupId, brnStatus, visaStatus, isAdmin, workflowStatus,
}: { groupId: string; brnStatus: string; visaStatus: string; isAdmin: boolean; workflowStatus: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const stage = workflowStatus || (visaStatus === "issued" ? "visa_issued" : brnStatus === "allocated" ? "brn_allocated" : "pending");
  const next = NEXT[stage];

  async function run(fn: string, args: any) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, { p_group: groupId, ...(args ?? {}) });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }
  async function del() {
    if (!confirm("Delete this group? This cannot be undone.")) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("delete_group", { p_group: groupId });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  if (stage === "visa_issued") {
    return isAdmin
      ? <Link href={`/groups/${groupId}/edit`} className="text-brand text-sm hover:underline">Edit</Link>
      : <span className="text-slate-400" title="Locked — visa issued">🔒</span>;
  }

  return (
    <div className="flex items-center gap-3">
      {next && (
        <button onClick={() => run(next.fn, next.args)} disabled={busy}
          className={`rounded px-2 py-0.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40 ${next.cls}`}>
          {busy ? "…" : next.label}
        </button>
      )}
      {stage === "pending" && (
        <button onClick={del} disabled={busy} className="text-xs text-red-600 hover:underline">Delete</button>
      )}
      {err && <span className="text-xs text-red-600" title={err}>⚠</span>}
    </div>
  );
}
