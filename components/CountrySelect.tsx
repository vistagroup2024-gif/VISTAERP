"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES } from "@/lib/countries";

// Searchable nationality dropdown. Stores the country name string.
export default function CountrySelect({
  value, onChange, placeholder = "Select nationality…", disabled,
}: { value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? COUNTRIES.filter((c) => c.toLowerCase().includes(s)) : COUNTRIES;
    return list.slice(0, 60);
  }, [q]);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" disabled={disabled}
        className="input flex w-full items-center justify-between text-left disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        onClick={() => { if (!disabled) setOpen((o) => !o); }}>
        <span className={value ? "" : "text-slate-400"}>{value || placeholder}</span>
        <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <input autoFocus className="input m-2 w-[calc(100%-1rem)]" placeholder="Search country…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-60 overflow-y-auto pb-2">
            {results.map((c) => (
              <li key={c}>
                <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => { onChange(c); setOpen(false); setQ(""); }}>{c}</button>
              </li>
            ))}
            {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
