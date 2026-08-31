"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import RowMenu from "@/components/RowMenu";
import { VEHICLE_STATUS_LABEL, VEHICLE_STATUS_TONE, VEHICLE_STATUSES, OWNERSHIP_LABEL, sar, vehicleTitle } from "../lib";

export interface VehicleRow {
  id: string; vehicle_no: string; vin: string | null; plate_no: string | null;
  make: string | null; model: string | null; variant: string | null; model_year: number | null; color: string | null;
  purchase_date: string | null; total_cost: number | null; status: string; ownership: string;
  location: string | null; supplier: string | null; customer: string | null;
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-slate-800"}`}>{value}</div>
    </div>
  );
}

export default function VehiclesTable({ rows, perms }: { rows: VehicleRow[]; perms: { canManage: boolean; canCost: boolean } }) {
  const router = useRouter();
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [make, setMake] = useState<string[]>([]);
  const [ownership, setOwnership] = useState<string[]>([]);

  const makes = useMemo(() => Array.from(new Set(rows.map((r) => r.make).filter(Boolean))) as string[], [rows]);

  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const stats = {
    total: rows.length,
    in_stock: count("in_stock"),
    reserved: count("reserved"),
    sold: count("sold"),
    delivered: count("delivered"),
    held: count("held"),
    transferred: rows.filter((r) => r.ownership === "transferred").length,
    stockValue: rows.filter((r) => r.status === "in_stock").reduce((a, r) => a + Number(r.total_cost || 0), 0),
  };

  const filtered = useMemo(() => rows.filter((r) => {
    if (status.length && !status.includes(r.status)) return false;
    if (make.length && !make.includes(r.make ?? "")) return false;
    if (ownership.length && !ownership.includes(r.ownership)) return false;
    if (q) {
      const s = q.toLowerCase();
      const hay = [r.vehicle_no, r.vin, r.plate_no, r.make, r.model, r.variant, r.color, r.supplier, r.customer].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }), [rows, status, make, ownership, q]);

  async function del(r: VehicleRow) {
    if (!confirm(`Delete vehicle ${r.vehicle_no}? This cannot be undone.`)) return;
    setErr(null);
    const { error } = await supabase.rpc("car_vehicle_delete", { p_vehicle: r.id });
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <Stat label="Total" value={stats.total} />
        <Stat label="In Stock" value={stats.in_stock} tone="text-emerald-700" />
        <Stat label="Reserved" value={stats.reserved} tone="text-amber-700" />
        <Stat label="Sold" value={stats.sold} tone="text-blue-700" />
        <Stat label="Delivered" value={stats.delivered} tone="text-indigo-700" />
        <Stat label="Held by Vista" value={stats.held} tone="text-red-600" />
        <Stat label="Transferred" value={stats.transferred} tone="text-green-700" />
      </div>
      {perms.canCost && <div className="grid grid-cols-1 sm:max-w-xs"><Stat label="Stock Value (in stock)" value={sar(stats.stockValue)} /></div>}

      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search plate / VIN / make / model…" value={q} onChange={(e) => setQ(e.target.value)} />
        <MultiSelectFilter label="Status" options={VEHICLE_STATUSES.map((s) => ({ value: s, label: VEHICLE_STATUS_LABEL[s] }))} selected={status} onChange={setStatus} />
        {makes.length > 0 && <MultiSelectFilter label="Make" options={makes.map((m) => ({ value: m, label: m }))} selected={make} onChange={setMake} />}
        <MultiSelectFilter label="Ownership" options={[{ value: "vista", label: "Vista-owned" }, { value: "transferred", label: "Transferred" }]} selected={ownership} onChange={setOwnership} />
        <span className="ml-auto text-sm text-slate-500">{filtered.length} / {rows.length}</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Vehicle</th><th className="th">Plate</th><th className="th">VIN</th>
              <th className="th">Supplier</th>{perms.canCost && <th className="th text-right">Total Cost</th>}
              <th className="th">Location</th><th className="th">Customer</th><th className="th">Ownership</th><th className="th">Status</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="td">
                  <Link href={`/car-sales/vehicles/${r.id}`} className="font-medium text-brand hover:underline">{vehicleTitle(r)}</Link>
                  <div className="text-xs text-slate-400">{r.vehicle_no}{r.color ? ` · ${r.color}` : ""}</div>
                </td>
                <td className="td">{r.plate_no ?? "—"}</td>
                <td className="td font-mono text-xs">{r.vin ?? "—"}</td>
                <td className="td">{r.supplier ?? "—"}</td>
                {perms.canCost && <td className="td text-right tabular-nums">{sar(r.total_cost)}</td>}
                <td className="td">{r.location ?? "—"}</td>
                <td className="td">{r.customer ?? "—"}</td>
                <td className="td"><span className={`badge ${r.ownership === "transferred" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>{OWNERSHIP_LABEL[r.ownership] ?? r.ownership}</span></td>
                <td className="td"><span className={`badge ${VEHICLE_STATUS_TONE[r.status] ?? "bg-slate-100"}`}>{VEHICLE_STATUS_LABEL[r.status] ?? r.status}</span></td>
                <td className="td text-right">
                  <RowMenu items={[
                    { label: "Open", onClick: () => router.push(`/car-sales/vehicles/${r.id}`) },
                    ...(perms.canManage ? [
                      { label: "Edit", onClick: () => router.push(`/car-sales/vehicles/${r.id}/edit`) },
                      { label: "Delete", onClick: () => del(r), danger: true },
                    ] : []),
                  ]} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={perms.canCost ? 10 : 9}>No vehicles match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
