"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

interface Vendor { id: string; name: string; vendor_type: string; contact_person: string | null; mobile: string | null; email: string | null; notes: string | null; username: string | null; is_active: boolean; vehicle_ids: string[] | null }
interface Vehicle { id: string; name: string; seating_capacity: number | null }
const BLANK = { name: "", vendor_type: "vendor", contact_person: "", mobile: "", email: "", notes: "", vehicle_ids: [] as string[] };
const TYPE_LABEL: Record<string, string> = { vendor: "Vendor (supplies driver)", vendor_driver: "Vendor Driver (is the driver)" };

export default function VendorManager({ initial, vehicles }: { initial: Vendor[]; vehicles: Vehicle[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>({});

  const payload = (f: any) => {
    const isDriver = (f.vendor_type || "vendor") === "vendor_driver";
    // A vendor-driver operates a single vehicle; keep at most one.
    const vids: string[] = (f.vehicle_ids ?? []).slice(0, isDriver ? 1 : undefined);
    return { name: f.name.trim(), vendor_type: f.vendor_type || "vendor", contact_person: f.contact_person.trim() || null, mobile: f.mobile.trim() || null, email: f.email.trim() || null, notes: f.notes.trim() || null, vehicle_ids: vids };
  };

  // Vehicle chooser: single-select for vendor-driver, multi-select for vendor.
  function VehiclePicker({ value, type, onChange }: { value: string[]; type: string; onChange: (ids: string[]) => void }) {
    const single = type === "vendor_driver";
    const toggle = (id: string) => {
      if (single) onChange(value.includes(id) ? [] : [id]);
      else onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
    };
    return (
      <div className="flex flex-wrap gap-1.5">
        {vehicles.map((v) => {
          const on = value.includes(v.id);
          return (
            <button key={v.id} type="button" onClick={() => toggle(v.id)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-brand bg-brand/10 text-brand" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
              {on ? "✓ " : ""}{v.name}{v.seating_capacity ? ` (${v.seating_capacity})` : ""}
            </button>
          );
        })}
        {vehicles.length === 0 && <span className="text-xs text-slate-400">No vehicles.</span>}
      </div>
    );
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("transport_vendors").insert({ company_id: COMPANY_ID, ...payload(form) });
    setBusy(false);
    if (error) return setErr(error.message);
    setForm({ ...BLANK }); router.refresh();
  }
  async function toggle(v: Vendor) { await supabase.from("transport_vendors").update({ is_active: !v.is_active }).eq("id", v.id); router.refresh(); }
  function startEdit(v: Vendor) { setEditId(v.id); setEdit({ name: v.name, vendor_type: v.vendor_type ?? "vendor", contact_person: v.contact_person ?? "", mobile: v.mobile ?? "", email: v.email ?? "", notes: v.notes ?? "", vehicle_ids: v.vehicle_ids ?? [] }); }
  const vehName = (id: string) => vehicles.find((x) => x.id === id)?.name ?? "?";
  async function saveEdit(id: string) { setBusy(true); const { error } = await supabase.from("transport_vendors").update(payload(edit)).eq("id", id); setBusy(false); if (error) return setErr(error.message); setEditId(null); router.refresh(); }
  async function del(v: Vendor) { if (!confirm(`Delete vendor "${v.name}"?`)) return; const { error } = await supabase.from("transport_vendors").delete().eq("id", v.id); if (error) return setErr(error.message); router.refresh(); }
  async function setLogin(v: Vendor) {
    const username = prompt(`Vendor portal username for "${v.name}":`, v.username ?? "");
    if (username === null) return;
    const password = prompt("Set password (leave blank to keep current):", "");
    if (password === null) return;
    const { error } = await supabase.rpc("vendor_set_credentials", { p_vendor: v.id, p_username: username.trim(), p_password: password });
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div><label className="label">Vendor name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div><label className="label">Type *</label>
          <select className="input" value={form.vendor_type} onChange={(e) => setForm({ ...form, vendor_type: e.target.value })}>
            <option value="vendor">Vendor (supplies driver)</option>
            <option value="vendor_driver">Vendor Driver (is the driver)</option>
          </select></div>
        <div><label className="label">{form.vendor_type === "vendor_driver" ? "Driver name" : "Contact"}</label><input className="input" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
        <div><label className="label">Mobile</label><input className="input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
        <div><label className="label">Email</label><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div className="flex items-end"><button className="btn w-full" disabled={busy}>{busy ? "…" : "+ Add"}</button></div>
        <div className="sm:col-span-6">
          <label className="label">{form.vendor_type === "vendor_driver" ? "Vehicle (choose one)" : "Vehicles (choose all they operate)"}</label>
          <VehiclePicker value={form.vehicle_ids} type={form.vendor_type} onChange={(ids) => setForm({ ...form, vehicle_ids: ids })} />
        </div>
        {form.vendor_type === "vendor_driver" && <p className="text-xs text-slate-500 sm:col-span-6">This vendor is the driver — their name &amp; mobile above are used as the driver details when a trip is assigned to them.</p>}
        {err && <p className="text-sm text-red-600 sm:col-span-6">{err}</p>}
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="th">Vendor</th><th className="th">Type</th><th className="th">Contact</th><th className="th">Mobile</th><th className="th">Vehicles</th><th className="th">Login</th><th className="th">Status</th><th className="th">Actions</th></tr></thead>
          <tbody>
            {initial.map((v) => editId === v.id ? (
              <tr key={v.id} className="border-t border-slate-100 bg-amber-50/40">
                <td className="td"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                <td className="td"><select className="input" value={edit.vendor_type} onChange={(e) => setEdit({ ...edit, vendor_type: e.target.value })}><option value="vendor">Vendor</option><option value="vendor_driver">Vendor Driver</option></select></td>
                <td className="td"><input className="input" value={edit.contact_person} onChange={(e) => setEdit({ ...edit, contact_person: e.target.value })} /></td>
                <td className="td"><input className="input" value={edit.mobile} onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} /></td>
                <td className="td"><input className="input" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></td>
                <td className="td"><VehiclePicker value={edit.vehicle_ids ?? []} type={edit.vendor_type} onChange={(ids) => setEdit({ ...edit, vehicle_ids: ids })} /></td>
                <td className="td" colSpan={2}><button onClick={() => saveEdit(v.id)} className="text-sm font-medium text-brand hover:underline">Save</button><button onClick={() => setEditId(null)} className="ml-3 text-sm text-slate-500 hover:underline">Cancel</button></td>
              </tr>
            ) : (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="td font-medium">{v.name}</td>
                <td className="td"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.vendor_type === "vendor_driver" ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-600"}`}>{v.vendor_type === "vendor_driver" ? "Vendor Driver" : "Vendor"}</span></td>
                <td className="td">{v.contact_person ?? "—"}</td>
                <td className="td">{v.mobile ?? "—"}</td>
                <td className="td">{v.vehicle_ids && v.vehicle_ids.length ? <span className="text-xs text-slate-600">{v.vehicle_ids.map(vehName).join(", ")}</span> : <span className="text-slate-400">any</span>}</td>
                <td className="td">{v.username ? <span className="font-mono text-xs">{v.username}</span> : <span className="text-slate-400">—</span>}</td>
                <td className="td"><button onClick={() => toggle(v)} className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>{v.is_active ? "Active" : "Inactive"}</button></td>
                <td className="td whitespace-nowrap"><button onClick={() => setLogin(v)} className="text-sm text-brand hover:underline">Set login</button><button onClick={() => startEdit(v)} className="ml-3 text-sm text-brand hover:underline">Edit</button><button onClick={() => del(v)} className="ml-3 text-sm text-red-600 hover:underline">Delete</button></td>
              </tr>
            ))}
            {initial.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No vendors yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
