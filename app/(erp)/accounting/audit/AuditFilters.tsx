"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Action is an independent criterion from date range — a user chasing down
// every rejected AND cancelled voucher in a window wants both toggled on at
// once, the same "show me A, or B, or both" shape this file's multi-select
// convention already covers elsewhere (TransactionsFilters' own `types` set).
// Empty means "every action", not "none" — the same convention
// TransactionsFilters.tsx's own `types` toggle already uses, so there is no
// "keep at least one selected" guard here.
const ACTIONS = [
  { value: "posted", label: "Posted" },
  { value: "submitted", label: "Submitted" },
  { value: "authorized", label: "Authorized" },
  { value: "approval", label: "Approval" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
  { value: "recurring_run", label: "Recurring Run" },
  { value: "depreciation_run", label: "Depreciation Run" },
  { value: "approvers_changed", label: "Approvers Changed" },
  { value: "group_issued_coverage_edit", label: "Coverage Edit" },
];

export default function AuditFilters({ from, to, action }: { from: string; to: string; action: string[] }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const [actions, setActions] = useState<Set<string>>(new Set(action));

  function run() {
    const p = new URLSearchParams();
    if (f) p.set("from", f);
    if (t) p.set("to", t);
    if (actions.size) p.set("action", Array.from(actions).join(","));
    router.push(`/accounting/audit${p.toString() ? `?${p.toString()}` : ""}`);
  }

  return (
    <div className="card mb-4 flex flex-wrap items-end gap-3 print:hidden">
      <div><label className="label">From</label><input type="date" value={f} onChange={(e) => setF(e.target.value)} className="input" /></div>
      <div><label className="label">To</label><input type="date" value={t} onChange={(e) => setT(e.target.value)} className="input" /></div>
      <div className="w-80"><label className="label">Action</label>
        <div className="flex flex-wrap gap-1">
          {ACTIONS.map((a) => (
            <button key={a.value} type="button"
              onClick={() => setActions((s) => { const n = new Set(s); n.has(a.value) ? n.delete(a.value) : n.add(a.value); return n; })}
              className={`rounded-full px-2 py-0.5 text-xs ${actions.has(a.value) ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <button onClick={run} className="btn h-[38px]">Run</button>
    </div>
  );
}
