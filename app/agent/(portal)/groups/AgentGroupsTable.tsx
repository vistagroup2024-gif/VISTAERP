"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { dateStr } from "@/lib/format";

export interface AgentRow {
  id: string;
  group_no: string;
  group_name: string;
  agent: string;
  group_date: string;
  arrival_date: string;
  departure_date: string;
  arrival_flight: string;
  hotels: string;
  pax: number;
  status_label: string;
  package_label: string;
}

const STATUS_CLS: Record<string, string> = {
  "Pending": "bg-yellow-100 text-yellow-800",
  "Under Process": "bg-blue-100 text-blue-700",
  "Visa Issued": "bg-emerald-600 text-white",
};

type Col = { key: keyof AgentRow; label: string; date?: boolean; plain?: boolean };

function HeaderCell({ col, rows, selected, sortDir, onToggle, onClear, onSort }: {
  col: Col; rows: AgentRow[]; selected: string[]; sortDir: 1 | -1 | 0;
  onToggle: (v: string) => void; onClear: () => void; onSort: (dir: 1 | -1) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const disp = (v: string) => (col.date ? dateStr(v) : v);
  const values = useMemo(() => {
    const set = Array.from(new Set(rows.map((r) => String(r[col.key] ?? "")).filter(Boolean))).sort();
    const s = q.trim().toLowerCase();
    return set.filter((v) => !s || disp(v).toLowerCase().includes(s) || v.toLowerCase().includes(s)).slice(0, 300);
  }, [rows, col, q]);
  const active = selected.length > 0;
  return (
    <th className="th relative" ref={ref}>
      <button className="inline-flex items-center gap-1 hover:text-slate-700" onClick={() => setOpen((o) => !o)}>
        {col.label}
        <span className={active || sortDir ? "text-brand" : "text-slate-400"}>{sortDir === 1 ? "▲" : sortDir === -1 ? "▼" : active ? "▣" : "▾"}</span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-2 text-left shadow-lg">
          <div className="mb-1 flex gap-1">
            <button className="flex-1 rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200" onClick={() => { onSort(1); setOpen(false); }}>Sort ↑</button>
            <button className="flex-1 rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200" onClick={() => { onSort(-1); setOpen(false); }}>Sort ↓</button>
            <button className="flex-1 rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200" onClick={() => { onClear(); setQ(""); }}>Clear</button>
          </div>
          <input autoFocus className="input mb-1 w-full text-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-56 overflow-y-auto text-left text-xs">
            {values.map((v) => (
              <li key={v}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                  <input type="checkbox" checked={selected.includes(v)} onChange={() => onToggle(v)} />
                  <span>{disp(v)}</span>
                </label>
              </li>
            ))}
            {values.length === 0 && <li className="px-2 py-1 text-slate-400">No values</li>}
          </ul>
        </div>
      )}
    </th>
  );
}

export default function AgentGroupsTable({ rows, showPackage }: { rows: AgentRow[]; showPackage: boolean }) {
  const COLS: Col[] = [
    { key: "group_date", label: "Date", date: true },
    { key: "group_no", label: "Group No" },
    { key: "group_name", label: "Name" },
    { key: "agent", label: "Agent" },
    { key: "pax", label: "Pax", plain: true },
    { key: "arrival_date", label: "Arrival", date: true },
    { key: "departure_date", label: "Departure", date: true },
    { key: "arrival_flight", label: "Flight No" },
    { key: "hotels", label: "Hotel Details" },
    { key: "status_label", label: "Visa Status" },
    ...(showPackage ? [{ key: "package_label", label: "Package" } as Col] : []),
  ];

  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: keyof AgentRow; dir: 1 | -1 } | null>({ key: "group_date", dir: -1 });

  const filtered = useMemo(() => {
    let r = rows.filter((row) => COLS.every((c) => {
      const f = filters[c.key as string];
      return !f || f.length === 0 || f.includes(String(row[c.key] ?? ""));
    }));
    if (sort) {
      const col = COLS.find((c) => c.key === sort.key);
      r = [...r].sort((a, b) => {
        let av: any = a[sort.key], bv: any = b[sort.key];
        if (col?.plain) { av = Number(av); bv = Number(bv); }
        return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
      });
    }
    return r;
  }, [rows, filters, sort]);

  const totalPax = filtered.reduce((s, g) => s + (Number(g.pax) || 0), 0);
  const anyFilter = Object.values(filters).some((v) => v && v.length > 0);
  const toggle = (key: string, v: string) => setFilters((f) => { const c = new Set(f[key] ?? []); c.has(v) ? c.delete(v) : c.add(v); return { ...f, [key]: Array.from(c) }; });
  const clearCol = (key: string) => setFilters((f) => { const n = { ...f }; delete n[key]; return n; });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">{filtered.length} of {rows.length} groups</span>
        {anyFilter && <button onClick={() => setFilters({})} className="btn-outline text-xs">Clear all filters</button>}
      </div>
      <div className="overflow-x-auto overflow-y-visible rounded-xl bg-white shadow-sm">
        <table className="w-full min-w-[1120px]">
          <thead className="bg-slate-50">
            <tr>
              {COLS.map((c) => c.plain
                ? <th key={c.key as string} className="th">{c.label}</th>
                : <HeaderCell key={c.key as string} col={c} rows={rows} selected={filters[c.key as string] ?? []}
                    sortDir={sort?.key === c.key ? sort.dir : 0} onToggle={(v) => toggle(c.key as string, v)}
                    onClear={() => clearCol(c.key as string)} onSort={(dir) => setSort({ key: c.key, dir })} />)}
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => (
              <tr key={g.id} className="border-t border-slate-100">
                <td className="td text-sm">{dateStr(g.group_date)}</td>
                <td className="td font-mono font-medium"><Link href={`/agent/groups/${g.id}`} className="text-brand hover:underline">{g.group_no}</Link></td>
                <td className="td">{g.group_name || "—"}</td>
                <td className="td text-slate-500">{g.agent}</td>
                <td className="td font-medium">{g.pax}</td>
                <td className="td text-sm">{dateStr(g.arrival_date)}</td>
                <td className="td text-sm">{dateStr(g.departure_date)}</td>
                <td className="td text-sm">{g.arrival_flight || "—"}</td>
                <td className="td text-sm">{g.hotels || "—"}</td>
                <td className="td"><span className={`badge ${STATUS_CLS[g.status_label] ?? "bg-slate-100"}`}>{g.status_label}</span></td>
                {showPackage && <td className="td text-sm text-slate-500">{g.package_label || "—"}</td>}
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={COLS.length}>No matching groups.</td></tr>}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="td" colSpan={4}>Total Pilgrims (filtered)</td>
              <td className="td text-brand-dark">{totalPax}</td>
              <td className="td" colSpan={COLS.length - 5}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
