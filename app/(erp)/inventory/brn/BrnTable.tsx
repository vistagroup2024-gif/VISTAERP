"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
  consumed: boolean;
}

type SortKey = keyof BrnRow;

const COLS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "brn", label: "BRN" },
  { key: "hotel_name", label: "Hotel" },
  { key: "city", label: "City" },
  { key: "supplier", label: "Supplier" },
  { key: "check_in", label: "Check-in" },
  { key: "check_out", label: "Check-out" },
  { key: "beds", label: "Total Beds", num: true },
  { key: "available", label: "Available", num: true },
  { key: "status", label: "Status" },
];

export default function BrnTable({ rows, isAdmin = false }: { rows: BrnRow[]; isAdmin?: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "check_in", dir: 1 });

  async function del(id: string, brn: string) {
    if (!confirm(`Delete BRN ${brn}? This cannot be undone.`)) return;
    setDeleting(id); setDelErr(null);
    const { error } = await supabase.rpc("delete_brn", { p_brn: id });
    setDeleting(null);
    if (error) { setDelErr(error.message); return; }
    router.refresh();
  }

  async function forceDel(id: string, brn: string) {
    const reason = prompt(`Super Admin force-delete of BRN ${brn}.\nThis releases all its allocations (affected groups revert to pending).\nEnter a reason (recorded in the audit log):`);
    if (reason === null) return;
    setDeleting(id); setDelErr(null);
    const { error } = await supabase.rpc("admin_delete_brn", { p_brn: id, p_reason: reason });
    setDeleting(null);
    if (error) { setDelErr(error.message); return; }
    router.refresh();
  }
  const [hotel, setHotel] = useState("");
  const [brn, setBrn] = useState("");
  const [city, setCity] = useState("");
  const [supplier, setSupplier] = useState("");
  const [status, setStatus] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [minAvail, setMinAvail] = useState("");

  const uniq = (vals: string[]) => Array.from(new Set(vals.filter(Boolean))).sort();
  const hotels = useMemo(() => uniq(rows.map((r) => r.hotel_name)), [rows]);
  const brns = useMemo(() => uniq(rows.map((r) => r.brn)), [rows]);
  const cities = useMemo(() => uniq(rows.map((r) => r.city)), [rows]);
  const suppliers = useMemo(() => uniq(rows.map((r) => r.supplier)), [rows]);
  const statuses = ["Available", "Full", "Overbooked"];

  const filtered = useMemo(() => {
    let r = rows.filter((row) =>
      (!hotel || row.hotel_name.toLowerCase().includes(hotel.toLowerCase())) &&
      (!brn || row.brn.toLowerCase().includes(brn.toLowerCase())) &&
      (!city || row.city === city) &&
      (!supplier || row.supplier === supplier) &&
      (!status || row.status === status) &&
      (!checkIn || row.check_in >= checkIn) &&
      (!checkOut || row.check_out <= checkOut) &&
      (minAvail === "" || row.available >= Number(minAvail))
    );
    const { key, dir } = sort;
    const col = COLS.find((c) => c.key === key);
    r = [...r].sort((a, b) => {
      let av: any = (a as any)[key], bv: any = (b as any)[key];
      if (col?.num) { av = Number(av); bv = Number(bv); }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return r;
  }, [rows, hotel, brn, city, supplier, status, checkIn, checkOut, minAvail, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  }
  function reset() {
    setHotel(""); setBrn(""); setCity(""); setSupplier(""); setStatus("");
    setCheckIn(""); setCheckOut(""); setMinAvail("");
  }

  const badge = (s: string) =>
    s === "Overbooked" ? "bg-red-500 text-white" : s === "Full" ? "bg-orange-400 text-white" : "bg-green-100 text-green-700";

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="card grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className="label">Hotel</label>
          <input className="input" list="brn-hotels" value={hotel} onChange={(e) => setHotel(e.target.value)} placeholder="All" />
          <datalist id="brn-hotels">{hotels.map((h) => <option key={h} value={h} />)}</datalist>
        </div>
        <div>
          <label className="label">BRN</label>
          <input className="input" list="brn-numbers" value={brn} onChange={(e) => setBrn(e.target.value)} placeholder="All" />
          <datalist id="brn-numbers">{brns.map((b) => <option key={b} value={b} />)}</datalist>
        </div>
        <div>
          <label className="label">City</label>
          <select className="input" value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">All</option>{cities.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Supplier</label>
          <select className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">All</option>{suppliers.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>{statuses.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Check-in from</label>
          <input className="input" type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </div>
        <div>
          <label className="label">Check-out to</label>
          <input className="input" type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </div>
        <div>
          <label className="label">Min available</label>
          <input className="input" type="number" value={minAvail} onChange={(e) => setMinAvail(e.target.value)} placeholder="0" />
        </div>
        <div className="col-span-2 flex items-end md:col-span-4">
          <button onClick={reset} className="btn-outline text-sm">Reset filters</button>
          <span className="ml-3 self-center text-sm text-slate-400">{filtered.length} of {rows.length}</span>
        </div>
      </div>

      {delErr && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{delErr}</div>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-slate-50">
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className="th cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort(c.key)}>
                  {c.label} <span className="text-slate-400">{sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
                </th>
              ))}
              <th className="th">Actions</th>
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
                <td className="td whitespace-nowrap">
                  <Link href={`/inventory/brn/${r.id}/edit`} className="text-brand text-sm hover:underline">Edit</Link>
                  {r.consumed ? (
                    isAdmin ? (
                      <button
                        onClick={() => forceDel(r.id, r.brn)}
                        disabled={deleting === r.id}
                        title="Super Admin force-delete (releases allocations)"
                        className="ml-3 text-sm text-red-600 hover:underline disabled:opacity-40">
                        {deleting === r.id ? "…" : "Force delete"}
                      </button>
                    ) : (
                      <span className="ml-3 text-sm text-slate-300" title="Cannot delete — inventory consumed">Delete</span>
                    )
                  ) : (
                    <button
                      onClick={() => del(r.id, r.brn)}
                      disabled={deleting === r.id}
                      className="ml-3 text-sm text-red-600 hover:underline disabled:opacity-40">
                      {deleting === r.id ? "…" : "Delete"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={COLS.length + 1}>No matching BRNs.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
