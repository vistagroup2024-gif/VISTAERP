"use client";

import { useMemo, useState } from "react";

export interface ScopeRow { id: string; name: string; parent_id: string | null; is_group?: boolean; code?: string | null }

// One restriction list — the "Restrict" tab of the old software, as a tree.
//
// Ticking a group covers everything under it, which is what the database does
// too (staff_scope_ids expands each listed node down its subtree). Children of a
// ticked group are therefore shown as already covered rather than as separate
// ticks, so the screen can't imply a finer rule than the engine enforces.
export default function ScopeTree({
  title, rows, value, onChange, exclude, onExclude, emptyNote,
}: {
  title: string;
  rows: ScopeRow[];
  value: string[];
  onChange: (v: string[]) => void;
  exclude: boolean;
  onExclude: (v: boolean) => void;
  emptyNote?: string;
}) {
  const [q, setQ] = useState("");
  const picked = useMemo(() => new Set(value), [value]);

  const children = useMemo(() => {
    const m = new Map<string | null, ScopeRow[]>();
    for (const r of rows) {
      const k = r.parent_id ?? null;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    m.forEach((list) => list.sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name)));
    return m;
  }, [rows]);

  // Ids whose name matches the search, plus every ancestor, so a match stays
  // reachable through its parents.
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const keep = new Set<string>();
    for (const r of rows) {
      if (!`${r.code ?? ""} ${r.name}`.toLowerCase().includes(needle)) continue;
      let cur: ScopeRow | undefined = r;
      while (cur) { keep.add(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
    }
    return keep;
  }, [rows, q]);

  function toggle(id: string) {
    onChange(picked.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  function render(parent: string | null, depth: number, coveredBy: string | null): JSX.Element[] {
    return (children.get(parent) ?? []).flatMap((r) => {
      if (visible && !visible.has(r.id)) return [];
      const covered = coveredBy !== null;
      const on = picked.has(r.id);
      const node = (
        <label key={r.id}
          className={`flex items-center gap-2 rounded px-1.5 py-1 text-sm ${covered ? "text-slate-400" : "cursor-pointer text-slate-700 hover:bg-slate-50"}`}
          style={{ paddingLeft: 6 + depth * 16 }}
          title={covered ? "Already covered by the group above" : undefined}>
          <input type="checkbox" className="h-3.5 w-3.5" checked={on || covered} disabled={covered} onChange={() => toggle(r.id)} />
          {r.code && <span className="font-mono text-xs text-slate-400">{r.code}</span>}
          <span className={r.is_group ? "font-medium" : ""}>{r.name}</span>
          {r.is_group && <span className="text-[10px] uppercase text-slate-300">group</span>}
        </label>
      );
      return [node, ...render(r.id, depth + 1, coveredBy ?? (on ? r.id : null))];
    });
  }

  const tree = render(null, 0, null);

  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-3 py-2">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${value.length ? (exclude ? "bg-red-50 text-red-600" : "bg-brand/10 text-brand") : "bg-slate-100 text-slate-500"}`}>
          {value.length === 0 ? "No restriction — all allowed" : exclude ? `${value.length} blocked` : `${value.length} allowed`}
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={exclude} onChange={(e) => onExclude(e.target.checked)} className="h-3.5 w-3.5" />
          Exclude (block the ticked ones instead)
        </label>
        {value.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-xs text-brand hover:underline">Clear</button>
        )}
      </div>
      <div className="px-3 py-2">
        <input className="input mb-2 text-sm" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-64 overflow-y-auto">
          {tree.length ? tree : <p className="px-1 py-3 text-sm text-slate-400">{emptyNote ?? "Nothing to show."}</p>}
        </div>
      </div>
    </div>
  );
}
