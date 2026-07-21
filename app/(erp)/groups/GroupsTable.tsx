"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { dateStr } from "@/lib/format";
import GroupActions from "./GroupActions";

export interface GroupRow {
  id: string;
  group_no: string;
  group_date: string;
  group_name: string;
  company: string;
  agent: string;
  pax: number;
  arrival_date: string;
  departure_date: string;
  total_nights: number;
  brn_status: string;
  visa_status: string;
  workflow_status: string;
  agent_brn_pending: boolean;
  package_status: string | null;
  visa_label: string;
  package_label: string;
}

const PKG_CLS: Record<string, string> = {
  "Complete Package": "bg-green-100 text-green-700",
  "Package Update Required": "bg-orange-100 text-orange-700",
  "Ready for Package Update": "bg-teal-100 text-teal-700",
  "Package Ready for Nusuk Update": "bg-amber-100 text-amber-800",
  "Package Updated": "bg-blue-100 text-blue-700",
};
const VISA_CLS: Record<string, string> = {
  "Visa Issued": "bg-emerald-600 text-white",
  "Package Assigned": "bg-violet-100 text-violet-700",
  "ERP Created": "bg-indigo-100 text-indigo-700",
  "BRN Allocated": "bg-green-100 text-green-700",
  "Pending": "bg-yellow-100 text-yellow-800",
};

type Col = { key: keyof GroupRow; label: string; date?: boolean; plain?: boolean };
const COLS: Col[] = [
  { key: "group_date", label: "Date", date: true },
  { key: "group_no", label: "Group No" },
  { key: "company", label: "Company" },
  { key: "group_name", label: "Name" },
  { key: "agent", label: "Agent" },
  { key: "pax", label: "Pax", plain: true },
  { key: "arrival_date", label: "Arrival", date: true },
  { key: "departure_date", label: "Departure", date: true },
  { key: "total_nights", label: "Nights", plain: true },
  { key: "visa_label", label: "Status" },
  { key: "package_label", label: "Package" },
];

function HeaderCell({
  col, rows, selected, sortDir, onToggle, onClear, onSort,
}: {
  col: Col;
  rows: GroupRow[];
  selected: string[];
  sortDir: 1 | -1 | 0;
  onToggle: (v: string) => void;
  onClear: () => void;
  onSort: (dir: 1 | -1) => void;
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
        <span className={active || sortDir ? "text-brand" : "text-slate-400"}>
          {sortDir === 1 ? "▲" : sortDir === -1 ? "▼" : active ? "▣" : "▾"}
        </span>
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

export default function GroupsTable({ rows, isAdmin }: { rows: GroupRow[]; isAdmin: boolean }) {
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: keyof GroupRow; dir: 1 | -1 } | null>({ key: "group_date", dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

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

  function toggleFilter(key: string, v: string) {
    setFilters((f) => {
      const cur = new Set(f[key] ?? []);
      cur.has(v) ? cur.delete(v) : cur.add(v);
      return { ...f, [key]: Array.from(cur) };
    });
  }
  function clearCol(key: string) { setFilters((f) => { const n = { ...f }; delete n[key]; return n; }); }
  function clearAll() { setFilters({}); }

  function toggleRow(id: string) { setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleAll() {
    setSelected((s) => s.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id)));
  }

  function copyGroupNos(sep: string) {
    const ids = selected.size ? selected : new Set(filtered.map((r) => r.id));
    const nos = filtered.filter((r) => ids.has(r.id)).map((r) => r.group_no);
    navigator.clipboard.writeText(nos.join(sep));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">{filtered.length} of {rows.length} groups</span>
        {anyFilter && <button onClick={clearAll} className="btn-outline text-xs">Clear all filters</button>}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-slate-500">{selected.size ? `${selected.size} selected` : "copy filtered"}:</span>
          <button onClick={() => copyGroupNos("\n")} className="btn-outline text-xs">Copy Group Nos (lines)</button>
          <button onClick={() => copyGroupNos(", ")} className="btn-outline text-xs">Copy (comma)</button>
          {copied && <span className="text-xs text-green-600">✓ Copied</span>}
        </div>
      </div>

      <div className="card overflow-x-auto overflow-y-visible p-0">
        <table className="w-full min-w-[1160px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th w-8">
                <input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={toggleAll} />
              </th>
              {COLS.map((c) =>
                c.plain ? (
                  <th key={c.key as string} className="th">{c.label}</th>
                ) : (
                  <HeaderCell
                    key={c.key as string}
                    col={c}
                    rows={rows}
                    selected={filters[c.key as string] ?? []}
                    sortDir={sort?.key === c.key ? sort.dir : 0}
                    onToggle={(v) => toggleFilter(c.key as string, v)}
                    onClear={() => clearCol(c.key as string)}
                    onSort={(dir) => setSort({ key: c.key, dir })}
                  />
                )
              )}
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => (
              <tr key={g.id} className="border-t border-slate-100">
                <td className="td"><input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleRow(g.id)} /></td>
                <td className="td text-sm">{dateStr(g.group_date)}</td>
                <td className="td font-mono font-medium"><Link href={`/groups/${g.id}`} className="text-brand hover:underline">{g.group_no}</Link></td>
                <td className="td text-slate-500">{g.company || "—"}</td>
                <td className="td">{g.group_name || "—"}</td>
                <td className="td text-slate-500">{g.agent || "—"}</td>
                <td className="td font-medium">{g.pax}</td>
                <td className="td text-sm">{dateStr(g.arrival_date)}</td>
                <td className="td text-sm">{dateStr(g.departure_date)}</td>
                <td className="td">{g.total_nights}</td>
                <td className="td"><span className={`badge ${VISA_CLS[g.visa_label] ?? "bg-slate-100"}`}>{g.visa_label}</span></td>
                <td className="td">{g.package_status ? <span className={`badge ${PKG_CLS[g.package_label] ?? "bg-slate-100 text-slate-600"}`}>{g.package_label}</span> : <span className="text-slate-300">—</span>}</td>
                <td className="td"><GroupActions groupId={g.id} brnStatus={g.brn_status} visaStatus={g.visa_status} workflowStatus={g.workflow_status} agentPending={g.agent_brn_pending} isAdmin={isAdmin} /></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={COLS.length + 2}>No matching groups.</td></tr>}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="td" colSpan={6}>Total Pax (filtered)</td>
              <td className="td text-brand-dark">{totalPax}</td>
              <td className="td" colSpan={COLS.length - 5}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
