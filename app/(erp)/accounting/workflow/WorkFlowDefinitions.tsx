"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import WorkFlowBoard from "@/components/accounting/WorkFlowBoard";
import { useDocRights } from "@/components/AccessProvider";

type Step = {
  doc_type: string; label: string; module: string;
  source_type: string | null; alt_source_type: string | null;
  enabled: boolean; sort: number; documents: number;
  is_trade: boolean; is_custom: boolean;
};

const blankNew = () => ({ doc_type: "", label: "", module: "", source_type: "" });

/**
 * Work Flow Definitions: every step the business has, which module it belongs
 * to, and which step each one is loaded from. This is the same table the board
 * draws and the same one trade_doc_source_type reads, so a change here changes
 * what the Load button on every voucher offers — it is the definition, not a
 * picture of one.
 *
 * A step can also be ADDED, for a flow the ERP did not ship with, and one you
 * added can be removed again. A step the ERP ships with can only be switched
 * off: there is a screen pointing at it, and deleting the definition would
 * orphan that screen rather than tidy anything up.
 */
export default function WorkFlowDefinitions() {
  const rights = useDocRights("workflow");
  const supabase = createClient();
  const [steps, setSteps] = useState<Step[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [nw, setNw] = useState(blankNew());
  const [key, setKey] = useState(0);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("workflow_steps_list");
    setSteps((data as Step[]) ?? []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const redraw = async () => { await load(); setKey((k) => k + 1); };

  async function save(s: Step, patch: Partial<Step>) {
    setBusy(s.doc_type); setErr(null);
    const next = { ...s, ...patch };
    const { error } = await supabase.rpc("workflow_step_save", {
      p_doc_type: s.doc_type,
      p_source: next.source_type,
      p_enabled: next.enabled,
      p_label: next.label,
      p_module: next.module,
      p_sort: next.sort,
    });
    setBusy(null);
    if (error) return setErr(error.message);
    await redraw();
  }

  async function addStep() {
    setBusy("+"); setErr(null);
    const { error } = await supabase.rpc("workflow_step_add", {
      p_doc_type: nw.doc_type || nw.label,
      p_label: nw.label,
      p_module: nw.module || null,
      p_source: nw.source_type || null,
      p_sort: null,
    });
    setBusy(null);
    if (error) return setErr(error.message);
    setNw(blankNew()); setAdding(false);
    await redraw();
  }

  async function removeStep(s: Step) {
    if (!confirm(`Remove the step “${s.label}” from the workflow? Documents already saved are not touched.`)) return;
    setBusy(s.doc_type); setErr(null);
    const { error } = await supabase.rpc("workflow_step_delete", { p_doc_type: s.doc_type });
    setBusy(null);
    if (error) return setErr(error.message);
    await redraw();
  }

  const labelOf = (t: string | null) => steps.find((s) => s.doc_type === t)?.label ?? "—";
  const modules = useMemo(
    () => Array.from(new Set(steps.map((s) => s.module))).sort(),
    [steps]);
  const grouped = useMemo(() => {
    const m = new Map<string, Step[]>();
    for (const s of steps) { if (!m.has(s.module)) m.set(s.module, []); m.get(s.module)!.push(s); }
    Array.from(m.values()).forEach((a) => a.sort((x, y) => x.sort - y.sort));
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [steps]);

  return (
    <div className="space-y-4">
      <WorkFlowBoard reloadKey={key} />

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setOpen((o) => !o)} className="btn-outline text-sm">
          {open ? "Hide" : "⚙"} Work Flow Definitions
        </button>
        <span className="text-xs text-slate-400">
          Every step you have, what each is loaded from, and where it belongs.
        </span>
        {open && rights.canCreate && (
          <button onClick={() => setAdding((a) => !a)} className="btn text-sm">
            {adding ? "Cancel" : "＋ New step"}
          </button>
        )}
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

          {adding && (
            <div className="card space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">New step</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div><label className="label">Name</label>
                  <input className="input" value={nw.label} placeholder="Proforma Invoice"
                    onChange={(e) => setNw({ ...nw, label: e.target.value })} /></div>
                <div><label className="label">Module</label>
                  <input className="input" list="wf-modules" value={nw.module} placeholder="Sales"
                    onChange={(e) => setNw({ ...nw, module: e.target.value })} />
                  <datalist id="wf-modules">{modules.map((m) => <option key={m} value={m} />)}</datalist></div>
                <div><label className="label">Loaded from</label>
                  <select className="input" value={nw.source_type}
                    onChange={(e) => setNw({ ...nw, source_type: e.target.value })}>
                    <option value="">— starts the chain —</option>
                    {steps.map((o) => <option key={o.doc_type} value={o.doc_type}>{o.label}</option>)}
                  </select></div>
                <div className="flex items-end">
                  <button onClick={addStep} disabled={busy === "+" || !nw.label.trim()} className="btn disabled:opacity-40">
                    {busy === "+" ? "Adding…" : "Add step"}
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                A step you add describes the flow — it does not build a screen. Use it to record a
                stage you work to, and to put it in the chain so the board shows the real route.
              </p>
            </div>
          )}

          {grouped.map(([mod, list]) => (
            <div key={mod} className="card overflow-x-auto p-0">
              <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {mod}
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Step</th>
                    <th className="px-3 py-2 text-left">Loaded from</th>
                    <th className="px-3 py-2 text-left">Also from</th>
                    <th className="px-3 py-2 text-left">Module</th>
                    <th className="px-3 py-2 text-right">Documents</th>
                    <th className="px-3 py-2 text-center">In use</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.doc_type} className={`border-t border-slate-100 ${s.enabled ? "" : "text-slate-400"}`}>
                      <td className="px-3 py-2">
                        <input className="input max-w-[13rem] font-medium" defaultValue={s.label}
                          disabled={busy === s.doc_type || !rights.canEdit}
                          onBlur={(e) => e.target.value.trim() && e.target.value !== s.label
                            && save(s, { label: e.target.value.trim() })} />
                      </td>
                      <td className="px-3 py-2">
                        <select className="input max-w-xs" value={s.source_type ?? ""}
                          disabled={busy === s.doc_type || !rights.canEdit}
                          onChange={(e) => save(s, { source_type: e.target.value || null })}>
                          <option value="">— starts the chain —</option>
                          {steps.filter((o) => o.doc_type !== s.doc_type)
                                .map((o) => <option key={o.doc_type} value={o.doc_type}>{o.label}</option>)}
                        </select>
                      </td>
                      {/* Built into the code rather than resolved from this
                          table, so it is shown and not offered for editing. */}
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {s.alt_source_type
                          ? <span title="Built into the voucher screen — shown here, not set here.">{labelOf(s.alt_source_type)}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <input className="input max-w-[10rem]" list="wf-modules" defaultValue={s.module}
                          disabled={busy === s.doc_type || !rights.canEdit}
                          onBlur={(e) => e.target.value.trim() && e.target.value !== s.module
                            && save(s, { module: e.target.value.trim() })} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {s.is_trade ? s.documents : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" checked={s.enabled}
                          disabled={busy === s.doc_type || !rights.canEdit}
                          title={rights.denied("edit")}
                          onChange={(e) => save(s, { enabled: e.target.checked })} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {s.is_custom && rights.canDelete && (
                          <button onClick={() => removeStep(s)} disabled={busy === s.doc_type}
                            className="text-slate-300 hover:text-red-500" title="Remove this step">×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <datalist id="wf-modules">{modules.map((m) => <option key={m} value={m} />)}</datalist>

          <p className="text-xs text-slate-400">
            The chain today:{" "}
            {steps.filter((s) => s.enabled && s.source_type)
                  .map((s) => `${s.label} ← ${labelOf(s.source_type)}`).join(" · ")}
          </p>
        </div>
      )}
    </div>
  );
}
