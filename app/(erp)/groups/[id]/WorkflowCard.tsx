"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const STAGES = [
  { key: "pending", label: "Pending" },
  { key: "brn_allocated", label: "BRN Allocated" },
  { key: "erp_created", label: "ERP Created" },
  { key: "package_assigned", label: "Package Assigned" },
  { key: "visa_issued", label: "Visa Issued" },
];

const NEXT: Record<string, { label: string; fn: string; args?: any }> = {
  pending: { label: "Allocate BRN", fn: "allocate_group_brns" },
  brn_allocated: { label: "ERP Created", fn: "advance_workflow", args: { p_to: "erp_created" } },
  erp_created: { label: "Package Assigned", fn: "advance_workflow", args: { p_to: "package_assigned" } },
  package_assigned: { label: "Visa Issued", fn: "mark_visa_issued" },
};

export default function WorkflowCard({
  groupId, workflowStatus, isAdmin,
}: { groupId: string; workflowStatus: string; isAdmin: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const idx = STAGES.findIndex((s) => s.key === workflowStatus);
  const next = NEXT[workflowStatus];

  async function run(fn: string, args?: any) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, { p_group: groupId, ...(args ?? {}) });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-700">🧭 Visa Workflow</h2>
        <div className="flex items-center gap-2">
          {next && (
            <button className="btn text-sm" disabled={busy} onClick={() => run(next.fn, next.args)}>
              {busy ? "…" : `Next: ${next.label}`}
            </button>
          )}
          {workflowStatus === "visa_issued" && isAdmin && (
            <button className="btn-outline text-sm" disabled={busy} onClick={() => run("reopen_group")}>Reopen (admin)</button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {STAGES.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${
              i < idx ? "bg-green-100 text-green-700"
              : i === idx ? "bg-brand text-white"
              : "bg-slate-100 text-slate-400"}`}>
              {i < idx ? "✓ " : ""}{s.label}
            </span>
            {i < STAGES.length - 1 && <span className="px-1 text-slate-300">→</span>}
          </div>
        ))}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
