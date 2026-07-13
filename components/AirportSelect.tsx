"use client";

import { useMemo, useRef, useState, useEffect } from "react";

export interface Airport {
  code: string;
  name: string;
  city: string | null;
  country: string | null;
  is_saudi: boolean;
}

export default function AirportSelect({
  airports, value, onChange, placeholder, saudiOnly,
}: {
  airports: Airport[];
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  saudiOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const pool = useMemo(
    () => airports.filter((a) => (saudiOnly ? a.is_saudi : true)),
    [airports, saudiOnly]
  );

  const selected = pool.find((a) => a.code === value);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? pool.filter((a) =>
          `${a.code} ${a.name} ${a.city ?? ""} ${a.country ?? ""}`.toLowerCase().includes(s)
        )
      : pool;
    return list.slice(0, 40);
  }, [q, pool]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        className="input flex w-full items-center justify-between text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected ? "" : "text-slate-400"}>
          {selected ? `${selected.city ?? selected.name} (${selected.code})` : placeholder ?? "Select…"}
        </span>
        <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <input
            autoFocus
            className="input m-2 w-[calc(100%-1rem)]"
            placeholder="Search city, airport, code…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="max-h-60 overflow-y-auto pb-2">
            {results.map((a) => (
              <li key={a.code}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => { onChange(a.code); setOpen(false); setQ(""); }}
                >
                  <span>
                    <b>{a.city ?? a.name}</b>{" "}
                    <span className="text-slate-400">{a.country}</span>
                  </span>
                  <span className="font-mono text-xs text-slate-500">{a.code}</span>
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
