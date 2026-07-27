"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

interface Route {
  id: string; name: string; from_location: string | null; to_location: string | null;
  distance_km: number | null; driving_minutes: number | null; rest_minutes: number; is_active: boolean;
}

const BLANK = { name: "", from_location: "", to_location: "", distance_km: "", driving_minutes: "", rest_minutes: "" };

function hm(mins: number | null) {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export default function RouteManager({ initial }: { initial: Route[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>({});
  const [q, setQ] = useState("");

  const num = (v: string) => (v === "" ? null : Number(v));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("transport_routes").insert({
      company_id: COMPANY_ID, name: form.name.trim(),
      from_location: form.from_location.trim() || null, to_location: form.to_location.trim() || null,
      distance_km: num(form.distance_km), driving_minutes: num(form.driving_minutes),
      rest_minutes: num(form.rest_minutes) ?? 0,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setForm({ ...BLANK });
    router.refresh();
  }

  async function toggleActive(r: Route) {
    await supabase.from("transport_routes").update({ is_active: !r.is_active }).eq("id", r.id);
    router.refresh();
  }

  function startEdit(r: Route) {
    setEditId(r.id);
    setEdit({
      name: r.name, from_location: r.from_location ?? "", to_location: r.to_location ?? "",
      distance_km: r.distance_km ?? "", driving_minutes: r.driving_minutes ?? "", rest_minutes: r.rest_minutes ?? 0,
    });
  }

  async function saveEdit(id: string) {
    setBusy(true); setErr(null);
    const { error } = await supabase.from("transport_routes").update({
      name: edit.name.trim(), from_location: edit.from_location.trim() || null, to_location: edit.to_location.trim() || null,
      distance_km: num(String(edit.distance_km)), driving_minutes: num(String(edit.driving_minutes)),
      rest_minutes: num(String(edit.rest_minutes)) ?? 0,
    }).eq("id", id);
    setBusy(false);
    if (error) return setErr(error.message);
    setEditId(null);
    router.refresh();
  }

  async function del(r: Route) {
    if (!confirm(`Delete route "${r.name}"?`)) return;
    setErr(null);
    const { error } = await supabase.rpc("delete_transport_route", { p_id: r.id });
    if (error) return setErr(error.message);
    router.refresh();
  }

  const rows = initial.filter((r) =>
    !q || [r.name, r.from_location, r.to_location].some((x) => (x ?? "").toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card grid grid-cols-1 gap-3 sm:grid-cols-7">
        <div className="sm:col-span-2"><label className="label">Route name *</label>
          <input className="input" placeholder="Jeddah Airport → Makkah" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div className="sm:col-span-1"><label className="label">From</label>
          <input className="input" value={form.from_location} onChange={(e) => setForm({ ...form, from_location: e.target.value })} /></div>
        <div className="sm:col-span-1"><label className="label">To</label>
          <input className="input" value={form.to_location} onChange={(e) => setForm({ ...form, to_location: e.target.value })} /></div>
        <div className="sm:col-span-1"><label className="label">Distance (km)</label>
          <input className="input" type="number" min="0" value={form.distance_km} onChange={(e) => setForm({ ...form, distance_km: e.target.value })} /></div>
        <div className="sm:col-span-1"><label className="label">Drive (min)</label>
          <input className="input" type="number" min="0" value={form.driving_minutes} onChange={(e) => setForm({ ...form, driving_minutes: e.target.value })} /></div>
        <div className="sm:col-span-1"><label className="label">Rest (min)</label>
          <input className="input" type="number" min="0" value={form.rest_minutes} onChange={(e) => setForm({ ...form, rest_minutes: e.target.value })} /></div>
        <div className="flex items-end sm:col-span-7"><button className="btn" disabled={busy}>{busy ? "…" : "+ Add route"}</button></div>
        {err && <p className="text-sm text-red-600 sm:col-span-7">{err}</p>}
      </form>

      <input className="input max-w-xs" placeholder="Search routes…" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr><th className="th">Route</th><th className="th">From → To</th><th className="th">Distance</th><th className="th">Drive</th><th className="th">Rest</th><th className="th">Status</th><th className="th">Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => editId === r.id ? (
              <tr key={r.id} className="border-t border-slate-100 bg-amber-50/40">
                <td className="td"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                <td className="td"><div className="flex gap-1">
                  <input className="input" value={edit.from_location} onChange={(e) => setEdit({ ...edit, from_location: e.target.value })} />
                  <input className="input" value={edit.to_location} onChange={(e) => setEdit({ ...edit, to_location: e.target.value })} /></div></td>
                <td className="td"><input className="input w-20" type="number" value={edit.distance_km} onChange={(e) => setEdit({ ...edit, distance_km: e.target.value })} /></td>
                <td className="td"><input className="input w-20" type="number" value={edit.driving_minutes} onChange={(e) => setEdit({ ...edit, driving_minutes: e.target.value })} /></td>
                <td className="td"><input className="input w-20" type="number" value={edit.rest_minutes} onChange={(e) => setEdit({ ...edit, rest_minutes: e.target.value })} /></td>
                <td className="td" colSpan={2}>
                  <button onClick={() => saveEdit(r.id)} disabled={busy} className="text-sm font-medium text-brand hover:underline">Save</button>
                  <button onClick={() => setEditId(null)} className="ml-3 text-sm text-slate-500 hover:underline">Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td font-medium"><Link href={`/transport/routes/${r.id}`} className="text-brand hover:underline">{r.name}</Link></td>
                <td className="td">{(r.from_location || r.to_location) ? `${r.from_location ?? "—"} → ${r.to_location ?? "—"}` : "—"}</td>
                <td className="td">{r.distance_km != null ? `${r.distance_km} km` : "—"}</td>
                <td className="td">{hm(r.driving_minutes)}</td>
                <td className="td">{r.rest_minutes ? `${r.rest_minutes}m` : "—"}</td>
                <td className="td">
                  <button onClick={() => toggleActive(r)} className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                    {r.is_active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="td whitespace-nowrap">
                  <Link href={`/transport/routes/${r.id}`} className="text-sm text-brand hover:underline">Rates</Link>
                  <button onClick={() => startEdit(r)} className="ml-3 text-sm text-brand hover:underline">Edit</button>
                  <button onClick={() => del(r)} className="ml-3 text-sm text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No routes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
