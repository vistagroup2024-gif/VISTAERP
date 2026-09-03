"use client";

import { useState } from "react";
import { DOC_TREE, RIGHT_LABEL, type DocRight, type DocRightsMap } from "@/lib/docRights";

// The "Access" tab: pick a voucher or report on the left, tick what the user may
// do with it on the right. Screens the ERP doesn't have are not in the tree —
// this lists the actual vouchers, not a fixed menu copied from elsewhere.
export default function DocRightsPicker({
  value, onChange,
}: { value: DocRightsMap; onChange: (v: DocRightsMap) => void }) {
  const first = DOC_TREE[0].groups[0].docs[0];
  const [sel, setSel] = useState(first.key);

  const node = DOC_TREE.flatMap((m) => m.groups.flatMap((g) => g.docs)).find((d) => d.key === sel) ?? first;
  const rights = value[sel] ?? {};
  const configured = Object.keys(value).length > 0;

  function setRight(right: DocRight, on: boolean) {
    const next: DocRightsMap = { ...value, [sel]: { ...(value[sel] ?? {}) } };
    if (on) next[sel][right] = true; else delete next[sel][right];
    if (Object.keys(next[sel]).length === 0) delete next[sel];
    onChange(next);
  }

  function setAll(on: boolean) {
    const next: DocRightsMap = { ...value };
    if (on) next[sel] = Object.fromEntries(node.rights.map((r) => [r, true]));
    else delete next[sel];
    onChange(next);
  }

  // Every screen, every right — the quickest way back to "no restriction".
  function grantEverything() { onChange({}); }

  function grantAll() {
    const next: DocRightsMap = {};
    for (const m of DOC_TREE) for (const g of m.groups) for (const d of g.docs) {
      next[d.key] = Object.fromEntries(d.rights.map((r) => [r, true]));
    }
    onChange(next);
  }

  function count(key: string) { return Object.keys(value[key] ?? {}).length; }

  return (
    <div className="space-y-3">
      <div className={`rounded px-3 py-2 text-xs ${configured ? "bg-amber-50 text-amber-700" : "bg-slate-50 text-slate-500"}`}>
        {configured
          ? "This user is restricted: only the screens and rights ticked below are allowed."
          : "Nothing ticked — this user has every screen and every right. Tick anything to switch them to restricted access."}
        {configured && (
          <button type="button" onClick={grantEverything} className="ml-2 font-medium text-brand hover:underline">
            Remove all restrictions
          </button>
        )}
        {!configured && (
          <button type="button" onClick={grantAll} className="ml-2 font-medium text-brand hover:underline">
            Start from everything ticked
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-slate-200 p-2">
          {DOC_TREE.map((m) => (
            <div key={m.module} className="mb-2">
              <div className="px-1.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{m.module}</div>
              {m.groups.map((g) => (
                <div key={g.group} className="mb-1">
                  <div className="px-1.5 py-0.5 pl-3 text-xs font-medium text-slate-500">{g.group}</div>
                  {g.docs.map((d) => {
                    const n = count(d.key);
                    return (
                      <button key={d.key} type="button" onClick={() => setSel(d.key)}
                        className={`flex w-full items-center gap-2 rounded px-1.5 py-1 pl-6 text-left text-sm ${
                          sel === d.key ? "bg-brand/10 font-medium text-brand" : "text-slate-700 hover:bg-slate-50"}`}>
                        <span className="min-w-0 flex-1 truncate">{d.label}</span>
                        {configured && (
                          <span className={`shrink-0 rounded-full px-1.5 text-[10px] ${
                            n === 0 ? "bg-red-50 text-red-500" : n === d.rights.length ? "bg-green-50 text-green-600" : "bg-slate-100 text-slate-500"}`}>
                            {n === 0 ? "none" : n === d.rights.length ? "full" : `${n}/${d.rights.length}`}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Rights — {node.label}</h3>
          </div>
          <div className="space-y-1.5">
            {node.rights.map((r) => (
              <label key={r} className="flex cursor-pointer items-start gap-2 text-sm text-slate-600">
                <input type="checkbox" className="mt-0.5 h-3.5 w-3.5" checked={!!rights[r]} onChange={(e) => setRight(r, e.target.checked)} />
                <span>{RIGHT_LABEL[r]}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setAll(true)} className="btn-outline text-xs">Select all</button>
            <button type="button" onClick={() => setAll(false)} className="btn-outline text-xs">Unselect all</button>
          </div>
          {node.href && <p className="mt-3 text-[11px] text-slate-400">Screen: {node.href}</p>}
        </div>
      </div>
    </div>
  );
}
