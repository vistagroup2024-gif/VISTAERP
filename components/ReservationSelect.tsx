"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface ResOption { id: string; label: string; sub?: string }

// Small searchable dropdown for picking a reservation ("Reserved Groups").
export default function ReservationSelect({
  options, value, onChange, placeholder, disabled,
}: {
  options: ResOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(s)) : options;
  }, [q, options]);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        disabled={disabled}
        className="input flex w-full items-center justify-between text-left disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        onClick={() => { if (!disabled) setOpen((o) => !o); }}
      >
        <span className={selected ? "" : "text-slate-400"}>{selected ? selected.label : placeholder ?? "Select…"}</span>
        <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <input autoFocus className="input m-2 w-[calc(100%-1rem)]" placeholder="Search reservations…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-60 overflow-y-auto pb-2">
            {results.map((o) => (
              <li key={o.id}>
                <button type="button" className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => { onChange(o.id); setOpen(false); setQ(""); }}>
                  <span className="font-medium">{o.label}</span>
                  {o.sub && <span className="text-xs text-slate-400">{o.sub}</span>}
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No active reservations for this company.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
