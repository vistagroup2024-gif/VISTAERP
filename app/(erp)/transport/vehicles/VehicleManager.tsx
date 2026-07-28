"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

interface Vehicle {
  id: string; category: string | null; name: string;
  seating_capacity: number | null; luggage_capacity: string | null; image: string | null;
  is_active: boolean; sort_order: number;
}

const BLANK = { category: "", name: "", seating_capacity: "", luggage_capacity: "", image: "" };

export default function VehicleManager({ initial }: { initial: Vehicle[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>({});
  const [q, setQ] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("transport_vehicles").insert({
      company_id: COMPANY_ID,
      category: form.category.trim() || null,
      name: form.name.trim(),
      seating_capacity: form.seating_capacity ? Number(form.seating_capacity) : null,
      luggage_capacity: form.luggage_capacity.trim() || null,
      image: form.image.trim() || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setForm({ ...BLANK });
    router.refresh();
  }

  async function toggleActive(v: Vehicle) {
    await supabase.from("transport_vehicles").update({ is_active: !v.is_active }).eq("id", v.id);
    router.refresh();
  }

  function startEdit(v: Vehicle) {
    setEditId(v.id);
    setEdit({
      category: v.category ?? "", name: v.name,
      seating_capacity: v.seating_capacity ?? "", luggage_capacity: v.luggage_capacity ?? "", image: v.image ?? "",
    });
  }

  async function saveEdit(id: string) {
    setBusy(true); setErr(null);
    const { error } = await supabase.from("transport_vehicles").update({
      category: edit.category.trim() || null,
      name: edit.name.trim(),
      seating_capacity: edit.seating_capacity ? Number(edit.seating_capacity) : null,
      luggage_capacity: edit.luggage_capacity.trim() || null,
      image: edit.image.trim() || null,
    }).eq("id", id);
    setBusy(false);
    if (error) return setErr(error.message);
    setEditId(null);
    router.refresh();
  }

  async function del(v: Vehicle) {
    if (!confirm(`Delete vehicle "${v.name}"? This cannot be undone.`)) return;
    setErr(null);
    const { error } = await supabase.rpc("delete_transport_vehicle", { p_id: v.id });
    if (error) return setErr(error.message);
    router.refresh();
  }

  const rows = initial.filter((v) =>
    !q || [v.name, v.category].some((x) => (x ?? "").toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-1"><label className="label">Category</label>
          <input className="input" placeholder="Sedan / Van / Bus" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
        <div className="sm:col-span-1"><label className="label">Name *</label>
          <input className="input" placeholder="Camry / Hiace / GMC" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div className="sm:col-span-1"><label className="label">Seats</label>
          <input className="input" type="number" min="0" value={form.seating_capacity} onChange={(e) => setForm({ ...form, seating_capacity: e.target.value })} /></div>
        <div className="sm:col-span-1"><label className="label">Luggage</label>
          <input className="input" placeholder="e.g. 4 bags" value={form.luggage_capacity} onChange={(e) => setForm({ ...form, luggage_capacity: e.target.value })} /></div>
        <div className="flex items-end sm:col-span-1"><button className="btn w-full" disabled={busy}>{busy ? "…" : "+ Add"}</button></div>
        <div className="sm:col-span-6"><label className="label">Image URL (optional)</label>
          <input className="input" placeholder="https://…" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} /></div>
        {err && <p className="text-sm text-red-600 sm:col-span-6">{err}</p>}
      </form>

      <input className="input max-w-xs" placeholder="Search vehicles…" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr><th className="th">Vehicle</th><th className="th">Category</th><th className="th">Seats</th><th className="th">Luggage</th><th className="th">Status</th><th className="th">Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((v) => editId === v.id ? (
              <tr key={v.id} className="border-t border-slate-100 bg-amber-50/40">
                <td className="td"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                <td className="td"><input className="input" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></td>
                <td className="td"><input className="input w-16" type="number" value={edit.seating_capacity} onChange={(e) => setEdit({ ...edit, seating_capacity: e.target.value })} /></td>
                <td className="td"><input className="input" value={edit.luggage_capacity} onChange={(e) => setEdit({ ...edit, luggage_capacity: e.target.value })} /></td>
                <td className="td" colSpan={2}>
                  <button onClick={() => saveEdit(v.id)} disabled={busy} className="text-sm font-medium text-brand hover:underline">Save</button>
                  <button onClick={() => setEditId(null)} className="ml-3 text-sm text-slate-500 hover:underline">Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="td font-medium">{v.name}</td>
                <td className="td">{v.category ?? "—"}</td>
                <td className="td">{v.seating_capacity ?? "—"}</td>
                <td className="td">{v.luggage_capacity ?? "—"}</td>
                <td className="td">
                  <button onClick={() => toggleActive(v)} className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                    {v.is_active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="td whitespace-nowrap">
                  <button onClick={() => startEdit(v)} className="text-sm text-brand hover:underline">Edit</button>
                  <button onClick={() => del(v)} className="ml-3 text-sm text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No vehicles yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
