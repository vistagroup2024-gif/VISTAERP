"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import WorkFlowBoard from "@/components/accounting/WorkFlowBoard";
import { useDocRights } from "@/components/AccessProvider";

type Step = {
  doc_type: string; label: string; source_type: string | null;
  enabled: boolean; sort: number; documents: number;
};

/**
 * Work Flow Definitions: which steps the business uses, and which step each one
 * is loaded from. This is the same table the board draws and the same one
 * trade_doc_source_type reads, so a change here changes what the Load button on
 * every voucher offers — it is the definition, not a picture of one.
 */
export default function WorkFlowDefinitions() {
  const rights = useDocRights("workflow");
  const supabase = createClient();
  const [steps, setSteps] = useState<Step[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("workflow_steps_list");
    setSteps((data as Step[]) ?? []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function save(docType: string, source: string | null, enabled: boolean) {
    setBusy(docType); setErr(null);
    const { error } = await supabase.rpc("workflow_step_save",
      { p_doc_type: docType, p_source: source, p_enabled: enabled });
    setBusy(null);
    if (error) return setErr(error.message);
    await load();
    setKey((k) => k + 1);          // redraw the board from the new definition
  }

  const labelOf = (t: string | null) => steps.find((s) => s.doc_type === t)?.label ?? "—";

  return (
    <div className="space-y-4">
      <WorkFlowBoard reloadKey={key} />

      <div className="flex items-center gap-3">
        <button onClick={() => setOpen((o) => !o)} className="btn-outline text-sm">
          {open ? "Hide" : "⚙"} Work Flow Definitions
        </button>
        <span className="text-xs text-slate-400">
          Which steps you use, and what each is loaded from.
        </span>
      </div>

      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      {open && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Switch a step off and the chain closes up behind it rather than breaking: turn off
            Material Receipt Notes and a Purchase Voucher is loaded straight from the Purchase
            Order. Documents already saved are never touched — only what the next voucher offers
            to load changes.
          </p>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Step</th>
                  <th className="px-3 py-2 text-left">Loaded from</th>
                  <th className="px-3 py-2 text-right">Documents</th>
                  <th className="px-3 py-2 text-center">In use</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.doc_type} className={`border-t border-slate-100 ${s.enabled ? "" : "text-slate-400"}`}>
                    <td className="px-3 py-2 font-medium">{s.label}</td>
                    <td className="px-3 py-2">
                      <select className="input max-w-xs" value={s.source_type ?? ""}
                        disabled={busy === s.doc_type || !rights.canEdit}
                        onChange={(e) => save(s.doc_type, e.target.value || null, s.enabled)}>
                        <option value="">— starts the chain —</option>
                        {steps.filter((o) => o.doc_type !== s.doc_type)
                              .map((o) => <option key={o.doc_type} value={o.doc_type}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.documents}</td>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" checked={s.enabled}
                        disabled={busy === s.doc_type || !rights.canEdit}
                        title={rights.denied("edit")}
                        onChange={(e) => save(s.doc_type, s.source_type, e.target.checked)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            The chain today:{" "}
            {steps.filter((s) => s.enabled).map((s) => `${s.label} ← ${labelOf(s.source_type)}`).join(" · ")}
          </p>
        </div>
      )}
    </div>
  );
}
