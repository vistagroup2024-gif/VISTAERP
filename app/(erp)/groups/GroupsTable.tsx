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
  package_status: string | null;
  visa_label: string;
  package_label: string;
}

const PKG_CLS: Record<string, string> = {
  "Complete Package": "bg-green-100 text-green-700",
  "Package Update Required": "bg-orange-100 text-orange-700",
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
  col, rows, active, sortDir, onPick, onSort, onClear,
}: {
  col: Col;
  rows: GroupRow[];
  active: string;
  sortDir: 1 | -1 | 0;
  onPick: (v: string) => void;
  onSort: (dir: 1 | -1) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const values = useMemo(() => {
    const set = Array.from(new Set(rows.map((r) => String(r[col.key] ?? "")).filter(Boolean)));
    set.sort();
    const s = q.trim().toLowerCase();
    const disp = (v: string) => (col.date ? dateStr(v) : v);
    return set.filter((v) => !s || disp(v).toLowerCase().includes(s) || v.toLowerCase().includes(s)).slice(0, 200);
  }, [rows, col, q]);

  const disp = (v: string) => (col.date ? dateStr(v) : v);

  return (
    <th className="th relative" ref={ref}>
      <button className="inline-flex items-center gap-1 hover:text-slate-700" onClick={() => setOpen((o) => !o)}>
        {col.label}
        <span className={active || sortDir ? "text-brand" : "text-slate-400"}>
          {sortDir === 1 ? "▲" : sortDir === -1 ? "▼" : active ? "▣" : "▾"}
        </span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 text-left shadow-lg">
          <div className="mb-1 flex gap-1">
            <button className="flex-1 rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200" onClick={() => { onSort(1); setOpen(false); }}>Sort ↑</button>
            <button className="flex-1 rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200" onClick={() => { onSort(-1); setOpen(false); }}>Sort ↓</button>
            <button className="flex-1 rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200" onClick={() => { onClear(); setQ(""); }}>Clear</button>
          </div>
          <input autoFocus className="input mb-1 w-full text-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-56 overflow-y-auto text-left text-xs">
            <li>
              <button className={`w-full rounded px-2 py-1 text-left hover:bg-slate-50 ${!active ? "font-semibold text-brand" : ""}`} onClick={() => { onClear(); setOpen(false); }}>
                (All)
              </button>
            </li>
            {values.map((v) => (
              <li key={v}>
                <button className={`w-full rounded px-2 py-1 text-left hover:bg-slate-50 ${active === v ? "font-semibold text-brand" : ""}`} onClick={() => { onPick(v); setOpen(false); }}>
                  {disp(v)}
                </button>
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
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: keyof GroupRow; dir: 1 | -1 } | null>({ key: "group_date", dir: -1 });

  const filtered = useMemo(() => {
    let r = rows.filter((row) => COLS.every((c) => !filters[c.key as string] || String(row[c.key] ?? "") === filters[c.key as string]));
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

  return (
    <div className="card overflow-x-auto overflow-y-visible p-0">
      <table className="w-full min-w-[1120px]">
        <thead className="bg-slate-50">
          <tr>
            {COLS.map((c) =>
              c.plain ? (
                <th key={c.key as string} className="th">{c.label}</th>
              ) : (
                <HeaderCell
                  key={c.key as string}
                  col={c}
                  rows={rows}
                  active={filters[c.key as string] ?? ""}
                  sortDir={sort?.key === c.key ? sort.dir : 0}
                  onPick={(v) => setFilters((f) => ({ ...f, [c.key as string]: v }))}
                  onSort={(dir) => setSort({ key: c.key, dir })}
                  onClear={() => setFilters((f) => { const n = { ...f }; delete n[c.key as string]; return n; })}
                />
              )
            )}
            <th className="th">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((g) => (
            <tr key={g.id} className="border-t border-slate-100">
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
              <td className="td"><GroupActions groupId={g.id} brnStatus={g.brn_status} visaStatus={g.visa_status} workflowStatus={g.workflow_status} isAdmin={isAdmin} /></td>
            </tr>
          ))}
          {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={COLS.length + 1}>No matching groups.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
