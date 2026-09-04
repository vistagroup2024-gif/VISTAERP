"use client";

import { DASHBOARD_CARDS, CARD_GROUPS, ALL_CARD_KEYS } from "@/lib/dashboardCards";

// Which dashboard cards this user may see. Unlike the Modules and Access tabs,
// an empty selection here grants NOTHING: only an admin sees every card, and
// everyone else sees exactly what is ticked.
export default function DashboardCardsPicker({
  value, onChange,
}: { value: Record<string, boolean>; onChange: (v: Record<string, boolean>) => void }) {
  const picked = Object.keys(value ?? {}).filter((k) => value[k]).length;

  function toggle(key: string) {
    const next = { ...value };
    if (next[key]) delete next[key]; else next[key] = true;
    onChange(next);
  }
  function setAll(on: boolean) {
    onChange(on ? Object.fromEntries(ALL_CARD_KEYS.map((k) => [k, true])) : {});
  }

  return (
    <div className="space-y-3">
      <div className={`rounded px-3 py-2 text-xs ${picked ? "bg-brand/5 text-slate-600" : "bg-amber-50 text-amber-700"}`}>
        {picked
          ? <>This user sees <b>{picked}</b> of {ALL_CARD_KEYS.length} cards on the dashboard.</>
          : <>Nothing ticked — this user’s dashboard will be empty. Tick the cards they should see.</>}
        <button type="button" onClick={() => setAll(true)} className="ml-2 font-medium text-brand hover:underline">Select all</button>
        {picked > 0 && (
          <button type="button" onClick={() => setAll(false)} className="ml-2 font-medium text-brand hover:underline">Clear all</button>
        )}
      </div>

      {CARD_GROUPS.map((g) => {
        const inGroup = DASHBOARD_CARDS.filter((c) => c.group === g);
        const allOn = inGroup.every((c) => value?.[c.key]);
        return (
          <div key={g} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">{g}</h3>
              <button type="button"
                onClick={() => {
                  const next = { ...value };
                  inGroup.forEach((c) => { if (allOn) delete next[c.key]; else next[c.key] = true; });
                  onChange(next);
                }}
                className="text-xs text-brand hover:underline">{allOn ? "Clear group" : "Select group"}</button>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {inGroup.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="mt-1 h-3.5 w-3.5" checked={!!value?.[c.key]} onChange={() => toggle(c.key)} />
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-700">{c.label}</span>
                    <span className="block text-xs text-slate-400">{c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
