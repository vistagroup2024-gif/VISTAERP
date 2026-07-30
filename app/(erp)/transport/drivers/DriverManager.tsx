"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

interface Vehicle { id: string; name: string }
interface Driver {
  id: string; name: string; iqama: string | null; license_no: string | null; mobile: string | null;
  vehicle_id: string | null; languages: string[]; status: string; emergency_contact: string | null;
  iqama_expiry: string | null; license_expiry: string | null; nusuk_registered?: boolean;
}

const BLANK = {
  name: "", iqama: "", license_no: "", mobile: "", vehicle_id: "", languages: "", status: "active",
  emergency_contact: "", iqama_expiry: "", license_expiry: "", nusuk_registered: false,
};

const STATUS: Record<string, string> = { active: "bg-green-100 text-green-700", inactive: "bg-slate-200 text-slate-500", on_leave: "bg-amber-100 text-amber-700" };

function expiringSoon(d: string | null) {
  if (!d) return false;
  const days = (new Date(d).getTime() - Date.now()) / 86400000;
  return days <= 30;
}

export default function DriverManager({ initial, vehicles }: { initial: Driver[]; vehicles: Vehicle[] }) {
  const router = useRouter();
  const supabase = createClient();
  const vName = new Map(vehicles.map((v) => [v.id, v.name]));
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>({});
  const [q, setQ] = useState("");

  function payload(f: any) {
    return {
      name: f.name.trim(), iqama: f.iqama.trim() || null, license_no: f.license_no.trim() || null,
      mobile: f.mobile.trim() || null, vehicle_id: f.vehicle_id || null,
      languages: f.languages ? String(f.languages).split(",").map((s: string) => s.trim()).filter(Boolean) : [],
      status: f.status, emergency_contact: f.emergency_contact.trim() || null,
      iqama_expiry: f.iqama_expiry || null, license_expiry: f.license_expiry || null,
      nusuk_registered: !!f.nusuk_registered,
    };
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("transport_drivers").insert({ company_id: COMPANY_ID, ...payload(form) });
    setBusy(false);
    if (error) return setErr(error.message);
    setForm({ ...BLANK });
    router.refresh();
  }

  function startEdit(d: Driver) {
    setEditId(d.id);
    setEdit({
      name: d.name, iqama: d.iqama ?? "", license_no: d.license_no ?? "", mobile: d.mobile ?? "",
      vehicle_id: d.vehicle_id ?? "", languages: (d.languages ?? []).join(", "), status: d.status,
      emergency_contact: d.emergency_contact ?? "", iqama_expiry: d.iqama_expiry ?? "", license_expiry: d.license_expiry ?? "",
      nusuk_registered: !!d.nusuk_registered,
    });
  }

  async function saveEdit(id: string) {
    setBusy(true); setErr(null);
    const { error } = await supabase.from("transport_drivers").update(payload(edit)).eq("id", id);
    setBusy(false);
    if (error) return setErr(error.message);
    setEditId(null);
    router.refresh();
  }

  async function del(d: Driver) {
    if (!confirm(`Delete driver "${d.name}"?`)) return;
    setErr(null);
    const { error } = await supabase.rpc("delete_transport_driver", { p_id: d.id });
    if (error) return setErr(error.message);
    router.refresh();
  }

  const rows = initial.filter((d) =>
    !q || [d.name, d.iqama, d.mobile].some((x) => (x ?? "").toLowerCase().includes(q.toLowerCase())));

  const fieldRow = (f: any, set: (o: any) => void) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
      <div><label className="label">Name *</label><input className="input" value={f.name} onChange={(e) => set({ ...f, name: e.target.value })} required /></div>
      <div><label className="label">Iqama</label><input className="input" value={f.iqama} onChange={(e) => set({ ...f, iqama: e.target.value })} /></div>
      <div><label className="label">License No.</label><input className="input" value={f.license_no} onChange={(e) => set({ ...f, license_no: e.target.value })} /></div>
      <div><label className="label">Mobile</label><input className="input" value={f.mobile} onChange={(e) => set({ ...f, mobile: e.target.value })} /></div>
      <div><label className="label">Vehicle</label>
        <select className="input" value={f.vehicle_id} onChange={(e) => set({ ...f, vehicle_id: e.target.value })}>
          <option value="">— none —</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select></div>
      <div><label className="label">Languages (comma)</label><input className="input" placeholder="Arabic, Urdu, English" value={f.languages} onChange={(e) => set({ ...f, languages: e.target.value })} /></div>
      <div><label className="label">Status</label>
        <select className="input" value={f.status} onChange={(e) => set({ ...f, status: e.target.value })}>
          <option value="active">Active</option><option value="inactive">Inactive</option><option value="on_leave">On leave</option>
        </select></div>
      <div><label className="label">Emergency contact</label><input className="input" value={f.emergency_contact} onChange={(e) => set({ ...f, emergency_contact: e.target.value })} /></div>
      <div><label className="label">Iqama expiry</label><input className="input" type="date" value={f.iqama_expiry} onChange={(e) => set({ ...f, iqama_expiry: e.target.value })} /></div>
      <div><label className="label">License expiry</label><input className="input" type="date" value={f.license_expiry} onChange={(e) => set({ ...f, license_expiry: e.target.value })} /></div>
      <div><label className="label">Nusuk Registered</label>
        <select className="input" value={f.nusuk_registered ? "yes" : "no"} onChange={(e) => set({ ...f, nusuk_registered: e.target.value === "yes" })}>
          <option value="no">No</option><option value="yes">Yes</option>
        </select></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card space-y-3">
        {fieldRow(form, setForm)}
        <div className="flex justify-end"><button className="btn" disabled={busy}>{busy ? "…" : "+ Add driver"}</button></div>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </form>

      <input className="input max-w-xs" placeholder="Search drivers…" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="space-y-3">
        {rows.map((d) => editId === d.id ? (
          <div key={d.id} className="card space-y-3 bg-amber-50/40">
            {fieldRow(edit, setEdit)}
            <div className="flex justify-end gap-3">
              <button onClick={() => saveEdit(d.id)} disabled={busy} className="btn">{busy ? "…" : "Save"}</button>
              <button onClick={() => setEditId(null)} className="btn-outline">Cancel</button>
            </div>
          </div>
        ) : (
          <div key={d.id} className="card flex flex-wrap items-center gap-x-6 gap-y-1">
            <div className="min-w-[10rem]">
              <div className="font-semibold text-slate-800">{d.name}</div>
              <div className="text-xs text-slate-500">{d.mobile ?? "no mobile"}{d.vehicle_id ? ` · ${vName.get(d.vehicle_id) ?? ""}` : ""}</div>
            </div>
            <div className="text-sm text-slate-600">Iqama: {d.iqama ?? "—"}</div>
            <div className={`text-sm ${expiringSoon(d.iqama_expiry) ? "font-medium text-red-600" : "text-slate-600"}`}>Iqama exp: {d.iqama_expiry ?? "—"}</div>
            <div className={`text-sm ${expiringSoon(d.license_expiry) ? "font-medium text-red-600" : "text-slate-600"}`}>Lic exp: {d.license_expiry ?? "—"}</div>
            <div className="text-sm text-slate-600">{(d.languages ?? []).join(", ") || "—"}</div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[d.status] ?? "bg-slate-200"}`}>{d.status.replace("_", " ")}</span>
            {d.nusuk_registered && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Nusuk ✓</span>}
            <div className="ml-auto whitespace-nowrap">
              <button onClick={() => startEdit(d)} className="text-sm text-brand hover:underline">Edit</button>
              <button onClick={() => del(d)} className="ml-3 text-sm text-red-600 hover:underline">Delete</button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="card text-slate-400">No drivers yet.</div>}
      </div>
    </div>
  );
}
