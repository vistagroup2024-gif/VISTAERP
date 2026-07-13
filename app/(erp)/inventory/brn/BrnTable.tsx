"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { dateStr } from "@/lib/format";

export interface BrnRow {
  id: string;
  brn: string;
  hotel_name: string;
  city: string;
  supplier: string;
  check_in: string;
  check_out: string;
  nights: number;
  beds: number;
  available: number;
  status: string;
}

type SortKey = keyof BrnRow;

const COLS: { key: SortKey; label: string; num?: boolean; date?: boolean }[] = [
  { key: "brn", label: "BRN" },
  { key: "hotel_name", label: "Hotel" },
  { key: "city", label: "City" },
  { key: "supplier", label: "Supplier" },
  { key: "check_in", label: "Check-in", date: true },
  { key: "check_out", label: "Check-out", date: true },
  { key: "beds", label: "Total Beds", num: true },
  { key: "available", label: "Available", num: true },
  { key: "status", label: "Status" },
];

export default function BrnTable({ rows }: { rows: BrnRow[] }) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "check_in", dir: 1 });

  const filtered = useMemo(() => {
    let r = rows.filter((row) =>
      COLS.every(({ key }) => {
        const f = (filters[key] ?? "").trim().toLowerCase();
        if (!f) return true;
        return String((row as any)[key]).toLowerCase().includes(f);
      })
    );
    const { key, dir } = sort;
    const col = COLS.find((c) => c.key === key);
    r = [...r].sort((a, b) => {
      let av: any = (a as any)[key], bv: any = (b as any)[key];
      if (col?.num) { av = Number(av); bv = Number(bv); }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return r;
  }, [rows, filters, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  }

  const badge = (s: string) =>
    s === "Overbooked" ? "bg-red-500 text-white"
      : s === "Full" ? "bg-orange-400 text-white"
      : "bg-green-100 text-green-700";

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-slate-50">
          <tr>
            {COLS.map((c) => (
              <th key={c.key} className="th cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort(c.key)}>
                {c.label}{" "}
                <span className="text-slate-400">{sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
              </th>
            ))}
          </tr>
          <tr>
            {COLS.map((c) => (
              <th key={c.key} className="px-2 pb-2">
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs font-normal"
                  placeholder="filter…"
                  value={filters[c.key] ?? ""}
                  onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="td font-mono font-medium">
                <Link href={`/inventory/brn/${r.id}`} className="text-brand hover:underline">{r.brn}</Link>
              </td>
              <td className="td">{r.hotel_name}</td>
              <td className="td">{r.city}</td>
              <td className="td text-slate-500">{r.supplier}</td>
              <td className="td whitespace-nowrap">{dateStr(r.check_in)}</td>
              <td className="td whitespace-nowrap">{dateStr(r.check_out)}</td>
              <td className="td text-right">{r.beds}</td>
              <td className="td text-right font-medium">{r.available}</td>
              <td className="td"><span className={`badge ${badge(r.status)}`}>{r.status}</span></td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td className="td text-slate-400" colSpan={COLS.length}>No matching BRNs.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
