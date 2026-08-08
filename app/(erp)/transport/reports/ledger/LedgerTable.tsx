"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dateStr } from "@/lib/format";
import InvoiceCheck from "./InvoiceCheck";

export interface LedgerRow {
  trip_id: string;
  trip_date: string | null;
  supplier_name: string | null;
  customer_name: string | null;
  haji_name: string | null;
  booking_car: string | null;
  driver_name: string | null;
  route: string | null;
  trip_fare: number | null;
  supplier_amount: number | null;
  cash_received: number | null;
  invoice_created: boolean;
}

const money = (n: any) => (n == null || n === "" ? "—" : `${Number(n).toFixed(2)} SAR`);

type Key = "supplier_name" | "customer_name" | "haji_name" | "booking_car" | "driver_name" | "route";

// Per-column multi-select filter (search + checkboxes), mirroring the Visa Groups table.
function HeaderFilter({
  label, rows, valueOf, selected, onToggle, onClear,
}: {
  label: string;
  rows: LedgerRow[];
  valueOf: (r: LedgerRow) => string;
  selected: string[];
  onToggle: (v: string) => void;
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
    const set = Array.from(new Set(rows.map(valueOf).filter(Boolean))).sort();
    const s = q.trim().toLowerCase();
    return set.filter((v) => !s || v.toLowerCase().includes(s)).slice(0, 300);
  }, [rows, valueOf, q]);
  const active = selected.length > 0;
  return (
    <th className="th relative" ref={ref}>
      <button className="inline-flex items-center gap-1 hover:text-slate-700" onClick={() => setOpen((o) => !o)}>
        {label}<span className={active ? "text-brand" : "text-slate-400"}>{active ? "▣" : "▾"}</span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-2 text-left shadow-lg">
          <div className="mb-1 flex gap-1">
            <button className="flex-1 rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200" onClick={() => { onClear(); setQ(""); }}>Clear</button>
          </div>
          <input autoFocus className="input mb-1 w-full text-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-56 overflow-y-auto text-left text-xs">
            {values.map((v) => (
              <li key={v}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                  <input type="checkbox" checked={selected.includes(v)} onChange={() => onToggle(v)} />
                  <span>{v}</span>
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

export default function LedgerTable({ rows, isAdmin }: { rows: LedgerRow[]; isAdmin: boolean }) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<Key, string[]>>({
    supplier_name: [], customer_name: [], haji_name: [], booking_car: [], driver_name: [], route: [],
  });
  const val = (r: LedgerRow, k: Key) => String(r[k] ?? "");
  const toggle = (k: Key, v: string) =>
    setFilters((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));
  const clear = (k: Key) => setFilters((f) => ({ ...f, [k]: [] }));

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const keys: Key[] = ["supplier_name", "customer_name", "haji_name", "booking_car", "driver_name", "route"];
    return rows.filter((r) => {
      if (s && !keys.some((k) => val(r, k).toLowerCase().includes(s))) return false;
      return keys.every((k) => filters[k].length === 0 || filters[k].includes(val(r, k)));
    });
  }, [rows, search, filters]);

  const totFare = filtered.reduce((a, r) => a + Number(r.trip_fare || 0), 0);
  const totSupp = filtered.reduce((a, r) => a + Number(r.supplier_amount || 0), 0);
  const totCash = filtered.reduce((a, r) => a + Number(r.cash_received || 0), 0);
  const anyFilter = search.trim() !== "" || Object.values(filters).some((a) => a.length > 0);

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <input className="input w-72 text-sm" placeholder="Search haji, agent, supplier, driver, route…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        {anyFilter && (
          <button className="text-sm text-brand hover:underline"
            onClick={() => { setSearch(""); setFilters({ supplier_name: [], customer_name: [], haji_name: [], booking_car: [], driver_name: [], route: [] }); }}>
            Reset filters
          </button>
        )}
        <span className="text-sm text-slate-400">{filtered.length} of {rows.length} trips</span>
      </div>

      <div className="card max-h-[75vh] overflow-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 thead-freeze"><tr>
            <th className="th">Trip Date</th>
            <HeaderFilter label="Supplier" rows={rows} valueOf={(r) => val(r, "supplier_name")} selected={filters.supplier_name} onToggle={(v) => toggle("supplier_name", v)} onClear={() => clear("supplier_name")} />
            <HeaderFilter label="Customer" rows={rows} valueOf={(r) => val(r, "customer_name")} selected={filters.customer_name} onToggle={(v) => toggle("customer_name", v)} onClear={() => clear("customer_name")} />
            <HeaderFilter label="Haji Name" rows={rows} valueOf={(r) => val(r, "haji_name")} selected={filters.haji_name} onToggle={(v) => toggle("haji_name", v)} onClear={() => clear("haji_name")} />
            <HeaderFilter label="Booking Car" rows={rows} valueOf={(r) => val(r, "booking_car")} selected={filters.booking_car} onToggle={(v) => toggle("booking_car", v)} onClear={() => clear("booking_car")} />
            <HeaderFilter label="Driver" rows={rows} valueOf={(r) => val(r, "driver_name")} selected={filters.driver_name} onToggle={(v) => toggle("driver_name", v)} onClear={() => clear("driver_name")} />
            <HeaderFilter label="Route" rows={rows} valueOf={(r) => val(r, "route")} selected={filters.route} onToggle={(v) => toggle("route", v)} onClear={() => clear("route")} />
            <th className="th text-right">Trip Fare</th><th className="th text-right">Supplier Amt</th><th className="th text-right">Cash Rcvd</th>
            <th className="th">Invoice</th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.trip_id} className={`border-t border-slate-100 ${r.invoice_created ? "" : "bg-amber-50/40"}`}>
                <td className="td whitespace-nowrap">{r.trip_date ? dateStr(r.trip_date) : "—"}</td>
                <td className="td">{r.supplier_name ?? <span className="text-slate-300">in-house</span>}</td>
                <td className="td">{r.customer_name ?? "—"}</td>
                <td className="td">{r.haji_name ?? "—"}</td>
                <td className="td">{r.booking_car ?? "—"}</td>
                <td className="td">{r.driver_name ?? <span className="text-slate-300">—</span>}</td>
                <td className="td">{r.route ?? "—"}</td>
                <td className="td text-right">{money(r.trip_fare)}</td>
                <td className="td text-right">{money(r.supplier_amount)}</td>
                <td className="td text-right">{r.cash_received == null ? "—" : money(r.cash_received)}</td>
                <td className="td"><InvoiceCheck tripId={r.trip_id} done={!!r.invoice_created} isAdmin={isAdmin} /></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={11}>No trips match.</td></tr>}
          </tbody>
          {filtered.length > 0 && (
            <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="td" colSpan={7}>Total ({filtered.length} trips)</td>
              <td className="td text-right">{money(totFare)}</td>
              <td className="td text-right">{money(totSupp)}</td>
              <td className="td text-right">{money(totCash)}</td>
              <td className="td"></td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
