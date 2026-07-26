"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Only the next valid action per stage (after the Process gate).
const NEXT: Record<string, { label: string; fn: string; args?: any }> = {
  process: { label: "Allocate BRN", fn: "allocate_group_brns" },
  brn_allocated: { label: "ERP Created", fn: "advance_workflow", args: { p_to: "erp_created" } },
  erp_created: { label: "Package Assigned", fn: "advance_workflow", args: { p_to: "package_assigned" } },
  package_assigned: { label: "Visa Issued", fn: "mark_visa_issued" },
};

type Item = { label: string; onClick: () => void; danger?: boolean };

export default function GroupActions({
  groupId, brnStatus, visaStatus, isAdmin, workflowStatus, agentPending,
}: { groupId: string; brnStatus: string; visaStatus: string; isAdmin: boolean; workflowStatus: string; agentPending?: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const stage = workflowStatus || (visaStatus === "issued" ? "visa_issued" : brnStatus === "allocated" ? "brn_allocated" : "pending");
  const next = NEXT[stage];

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function run(fn: string, args?: any, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setOpen(false); setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, { p_group: groupId, ...(args ?? {}) });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  if (agentPending) {
    return <Link href={`/groups/${groupId}`} className="badge bg-amber-100 text-amber-800 hover:underline" title="More agent BRNs pending">Agent BRNs pending</Link>;
  }

  // Build the menu for this stage.
  const items: Item[] = [];
  if (stage === "pending" || stage === "payment_pending") {
    items.push({ label: "✅ Process", onClick: () => run("set_group_decision", { p_decision: "process" }) });
    if (stage === "pending") items.push({ label: "💳 Payment", onClick: () => run("set_group_decision", { p_decision: "payment" }) });
    items.push({ label: "⛔ Reject", onClick: () => run("set_group_decision", { p_decision: "reject" }, "Reject this visa group?"), danger: true });
  }
  if (next) items.push({ label: `➡️ ${next.label}`, onClick: () => run(next.fn, next.args) });
  if (stage === "rejected" && isAdmin) items.push({ label: "↩️ Reopen", onClick: () => run("reopen_group") });
  if (stage === "visa_issued" && isAdmin) items.push({ label: "✏️ Edit", onClick: () => { setOpen(false); router.push(`/groups/${groupId}/edit`); } });
  items.push({ label: "🔎 Open", onClick: () => { setOpen(false); router.push(`/groups/${groupId}`); } });
  if (isAdmin && stage !== "visa_issued") {
    items.push({ label: "🗑 Delete", danger: true, onClick: () => run("delete_group", undefined, "Delete this group? Any reserved or allocated BRNs will be released automatically. This cannot be undone.") });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="rounded px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100 disabled:opacity-40"
        aria-label="Actions"
      >
        {busy ? "…" : "⋮"}
      </button>
      {err && <span className="ml-1 text-xs text-red-600" title={err}>⚠</span>}
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg">
          {items.map((it, i) => (
            <button
              key={i}
              onClick={it.onClick}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${it.danger ? "text-red-600" : "text-slate-700"}`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
