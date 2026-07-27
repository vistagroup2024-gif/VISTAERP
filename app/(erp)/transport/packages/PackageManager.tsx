"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

interface Vehicle { id: string; name: string }
interface Pkg {
  id: string; name: string; package_type: string; duration_days: number | null;
  vehicle_id: string | null; price: number; currency: string; is_active: boolean;
}

const BLANK = { name: "", package_type: "without_ziyarat", duration_days: "", vehicle_id: "", price: "" };
const TYPE_LABEL: Record<string, string> = { with_ziyarat: "With Ziyarat", without_ziyarat: "Without Ziyarat" };

export default function PackageManager({ initial, vehicles }: { initial: Pkg[]; vehicles: Vehicle[] }) {
  const router = useRouter();
  const supabase = createClient();
  const vName = new Map(vehicles.map((v) => [v.id, v.name]));
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>({});

  function payload(f: any) {
    return {
      name: f.name.trim(), package_type: f.package_type,
      duration_days: f.duration_days ? Number(f.duration_days) : null,
      vehicle_id: f.vehicle_id || null, price: f.price ? Number(f.price) : 0,
    };
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("transport_packages").insert({ company_id: COMPANY_ID, ...payload(form) });
    setBusy(false);
    if (error) return setErr(error.message);
    setForm({ ...BLANK });
    router.refresh();
  }

  async function toggleActive(p: Pkg) {
    await supabase.from("transport_packages").update({ is_active: !p.is_active }).eq("id", p.id);
    router.refresh();
  }

  function startEdit(p: Pkg) {
    setEditId(p.id);
    setEdit({ name: p.name, package_type: p.package_type, duration_days: p.duration_days ?? "", vehicle_id: p.vehicle_id ?? "", price: p.price ?? "" });
  }

  async function saveEdit(id: string) {
    setBusy(true); setErr(null);
    const { error } = await supabase.from("transport_packages").update(payload(edit)).eq("id", id);
    setBusy(false);
    if (error) return setErr(error.message);
    setEditId(null);
    router.refresh();
  }

  async function del(p: Pkg) {
    if (!confirm(`Delete package "${p.name}"?`)) return;
    setErr(null);
    const { error } = await supabase.rpc("delete_transport_package", { p_id: p.id });
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2"><label className="label">Package name *</label>
          <input className="input" placeholder="Umrah Transport — 4 trips" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div className="sm:col-span-1"><label className="label">Type</label>
          <select className="input" value={form.package_type} onChange={(e) => setForm({ ...form, package_type: e.target.value })}>
            <option value="without_ziyarat">Without Ziyarat</option><option value="with_ziyarat">With Ziyarat</option>
          </select></div>
        <div className="sm:col-span-1"><label className="label">Duration (days)</label>
          <input className="input" type="number" min="0" value={form.duration_days} onChange={(e) => setForm({ ...form, duration_days: e.target.value })} /></div>
        <div className="sm:col-span-1"><label className="label">Default vehicle</label>
          <select className="input" value={form.vehicle_id} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}>
            <option value="">— none —</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></div>
        <div className="sm:col-span-1"><label className="label">Price (SAR)</label>
          <input className="input" type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
        <div className="flex items-end justify-end sm:col-span-6"><button className="btn" disabled={busy}>{busy ? "…" : "+ Add package"}</button></div>
        {err && <p className="text-sm text-red-600 sm:col-span-6">{err}</p>}
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr><th className="th">Package</th><th className="th">Type</th><th className="th">Duration</th><th className="th">Vehicle</th><th className="th">Price</th><th className="th">Status</th><th className="th">Actions</th></tr>
          </thead>
          <tbody>
            {initial.map((p) => editId === p.id ? (
              <tr key={p.id} className="border-t border-slate-100 bg-amber-50/40">
                <td className="td"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                <td className="td"><select className="input" value={edit.package_type} onChange={(e) => setEdit({ ...edit, package_type: e.target.value })}><option value="without_ziyarat">Without Ziyarat</option><option value="with_ziyarat">With Ziyarat</option></select></td>
                <td className="td"><input className="input w-16" type="number" value={edit.duration_days} onChange={(e) => setEdit({ ...edit, duration_days: e.target.value })} /></td>
                <td className="td"><select className="input" value={edit.vehicle_id} onChange={(e) => setEdit({ ...edit, vehicle_id: e.target.value })}><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></td>
                <td className="td"><input className="input w-24" type="number" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} /></td>
                <td className="td" colSpan={2}>
                  <button onClick={() => saveEdit(p.id)} disabled={busy} className="text-sm font-medium text-brand hover:underline">Save</button>
                  <button onClick={() => setEditId(null)} className="ml-3 text-sm text-slate-500 hover:underline">Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="td font-medium"><Link href={`/transport/packages/${p.id}`} className="text-brand hover:underline">{p.name}</Link></td>
                <td className="td">{TYPE_LABEL[p.package_type] ?? p.package_type}</td>
                <td className="td">{p.duration_days ? `${p.duration_days} days` : "—"}</td>
                <td className="td">{p.vehicle_id ? vName.get(p.vehicle_id) ?? "—" : "—"}</td>
                <td className="td">{p.price ? `${p.price} ${p.currency}` : "—"}</td>
                <td className="td">
                  <button onClick={() => toggleActive(p)} className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                    {p.is_active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="td whitespace-nowrap">
                  <Link href={`/transport/packages/${p.id}`} className="text-sm text-brand hover:underline">Build</Link>
                  <button onClick={() => startEdit(p)} className="ml-3 text-sm text-brand hover:underline">Edit</button>
                  <button onClick={() => del(p)} className="ml-3 text-sm text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
            {initial.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No packages yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
