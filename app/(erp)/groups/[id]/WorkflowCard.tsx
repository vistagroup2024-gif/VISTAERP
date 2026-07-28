"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const STAGES = [
  { key: "pending", label: "Pending" },
  { key: "process", label: "Process" },
  { key: "brn_allocated", label: "BRN Allocated" },
  { key: "erp_created", label: "ERP Created" },
  { key: "package_assigned", label: "Package Assigned" },
  { key: "visa_issued", label: "Visa Issued" },
];

const NEXT: Record<string, { label: string; fn: string; args?: any }> = {
  process: { label: "Allocate BRN", fn: "allocate_group_brns" },
  brn_allocated: { label: "ERP Created", fn: "advance_workflow", args: { p_to: "erp_created" } },
  erp_created: { label: "Package Assigned", fn: "advance_workflow", args: { p_to: "package_assigned" } },
  package_assigned: { label: "Visa Issued", fn: "mark_visa_issued" },
};

export default function WorkflowCard({
  groupId, workflowStatus, isAdmin, visaType,
}: { groupId: string; workflowStatus: string; isAdmin: boolean; visaType?: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Long Stay and Masar visas skip BRN allocation — the BRNs are already known
  // (agent-provided for Masar), so Process goes straight to ERP Created.
  const skipBrn = visaType === "long_stay" || visaType === "masar";
  const stages = skipBrn ? STAGES.filter((s) => s.key !== "brn_allocated") : STAGES;
  const idx = stages.findIndex((s) => s.key === workflowStatus);
  const next = workflowStatus === "process" && skipBrn
    ? { label: "ERP Created", fn: "advance_workflow", args: { p_to: "erp_created" } }
    : NEXT[workflowStatus];

  async function run(fn: string, args?: any, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
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
        <div className="flex flex-wrap items-center gap-2">
          {/* Initial admin decision gate before any allocation */}
          {(workflowStatus === "pending" || !workflowStatus) && (
            <>
              <button className="btn text-sm" disabled={busy} onClick={() => run("set_group_decision", { p_decision: "process" })}>Process</button>
              <button className="btn-outline text-sm" disabled={busy} onClick={() => run("set_group_decision", { p_decision: "payment" })}>Payment</button>
              <button className="btn-outline text-sm text-red-600" disabled={busy} onClick={() => run("set_group_decision", { p_decision: "reject" }, "Reject this visa group?")}>Reject</button>
            </>
          )}
          {workflowStatus === "payment_pending" && (
            <>
              <span className="badge bg-rose-100 text-rose-700">Payment Pending</span>
              <button className="btn text-sm" disabled={busy} onClick={() => run("set_group_decision", { p_decision: "process" })}>Payment Received → Process</button>
              <button className="btn-outline text-sm text-red-600" disabled={busy} onClick={() => run("set_group_decision", { p_decision: "reject" }, "Reject this visa group?")}>Reject</button>
            </>
          )}
          {workflowStatus === "rejected" && isAdmin && (
            <>
              <span className="badge bg-red-100 text-red-700">Rejected</span>
              <button className="btn-outline text-sm" disabled={busy} onClick={() => run("reopen_group")}>Reopen (admin)</button>
            </>
          )}
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
        {stages.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${
              i < idx ? "bg-green-100 text-green-700"
              : i === idx ? "bg-brand text-white"
              : "bg-slate-100 text-slate-400"}`}>
              {i < idx ? "✓ " : ""}{s.label}
            </span>
            {i < stages.length - 1 && <span className="px-1 text-slate-300">→</span>}
          </div>
        ))}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
