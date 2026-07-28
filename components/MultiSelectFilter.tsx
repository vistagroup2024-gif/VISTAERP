"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface FilterOption { value: string; label: string }

// Excel-style filter: search + checkbox multi-select in a dropdown.
export default function MultiSelectFilter({
  label, options, selected, onChange,
}: { label: string; options: FilterOption[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options;
  }, [q, options]);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={`input flex items-center gap-2 text-sm ${selected.length ? "border-brand text-brand-dark" : ""}`}>
        {label}{selected.length > 0 && <span className="rounded-full bg-brand px-1.5 text-xs text-white">{selected.length}</span>}
        <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 p-2">
            <input autoFocus className="input flex-1" placeholder={`Search ${label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
            {selected.length > 0 && <button onClick={() => onChange([])} className="text-xs text-slate-500 hover:underline">Clear</button>}
          </div>
          <ul className="max-h-60 overflow-y-auto pb-2">
            {results.map((o) => (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                  {o.label}
                </label>
              </li>
            ))}
            {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
