"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

interface Vendor { id: string; name: string; contact_person: string | null; mobile: string | null; email: string | null; notes: string | null; username: string | null; is_active: boolean }
const BLANK = { name: "", contact_person: "", mobile: "", email: "", notes: "" };

export default function VendorManager({ initial }: { initial: Vendor[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>({});

  const payload = (f: any) => ({ name: f.name.trim(), contact_person: f.contact_person.trim() || null, mobile: f.mobile.trim() || null, email: f.email.trim() || null, notes: f.notes.trim() || null });

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
  function startEdit(v: Vendor) { setEditId(v.id); setEdit({ name: v.name, contact_person: v.contact_person ?? "", mobile: v.mobile ?? "", email: v.email ?? "", notes: v.notes ?? "" }); }
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
      <form onSubmit={add} className="card grid grid-cols-1 gap-3 sm:grid-cols-5">
        <div><label className="label">Vendor name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div><label className="label">Contact</label><input className="input" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
        <div><label className="label">Mobile</label><input className="input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
        <div><label className="label">Email</label><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div className="flex items-end"><button className="btn w-full" disabled={busy}>{busy ? "…" : "+ Add"}</button></div>
        {err && <p className="text-sm text-red-600 sm:col-span-5">{err}</p>}
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="th">Vendor</th><th className="th">Contact</th><th className="th">Mobile</th><th className="th">Login</th><th className="th">Status</th><th className="th">Actions</th></tr></thead>
          <tbody>
            {initial.map((v) => editId === v.id ? (
              <tr key={v.id} className="border-t border-slate-100 bg-amber-50/40">
                <td className="td"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                <td className="td"><input className="input" value={edit.contact_person} onChange={(e) => setEdit({ ...edit, contact_person: e.target.value })} /></td>
                <td className="td"><input className="input" value={edit.mobile} onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} /></td>
                <td className="td"><input className="input" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></td>
                <td className="td" colSpan={2}><button onClick={() => saveEdit(v.id)} className="text-sm font-medium text-brand hover:underline">Save</button><button onClick={() => setEditId(null)} className="ml-3 text-sm text-slate-500 hover:underline">Cancel</button></td>
              </tr>
            ) : (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="td font-medium">{v.name}</td>
                <td className="td">{v.contact_person ?? "—"}</td>
                <td className="td">{v.mobile ?? "—"}</td>
                <td className="td">{v.username ? <span className="font-mono text-xs">{v.username}</span> : <span className="text-slate-400">—</span>}</td>
                <td className="td"><button onClick={() => toggle(v)} className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>{v.is_active ? "Active" : "Inactive"}</button></td>
                <td className="td whitespace-nowrap"><button onClick={() => setLogin(v)} className="text-sm text-brand hover:underline">Set login</button><button onClick={() => startEdit(v)} className="ml-3 text-sm text-brand hover:underline">Edit</button><button onClick={() => del(v)} className="ml-3 text-sm text-red-600 hover:underline">Delete</button></td>
              </tr>
            ))}
            {initial.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No vendors yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
