"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface User { id: string; full_name: string; username: string; mobile: string | null; email: string | null; status: string; is_owner: boolean; permissions: Record<string, boolean> }
interface Grantable { module: string; perms: { key: string; label: string }[] }

const BLANK = { full_name: "", username: "", password: "", mobile: "", email: "", permissions: {} as Record<string, boolean> };

export default function AgentUsers({ users, grantable }: { users: User[]; grantable: Grantable[] }) {
  const router = useRouter();
  const [form, setForm] = useState<any>({ ...BLANK });
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function post(body: any) {
    setBusy(true); setErr(null); setMsg(null);
    const res = await fetch("/api/agent/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(json.error || "Failed"); return false; }
    router.refresh();
    return true;
  }

  function startEdit(u: User) {
    setEditId(u.id);
    setForm({ full_name: u.full_name, username: u.username, password: "", mobile: u.mobile ?? "", email: u.email ?? "", permissions: { ...u.permissions } });
    setErr(null); setMsg(null);
  }
  function reset() { setEditId(null); setForm({ ...BLANK }); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (editId) {
      const ok = await post({ action: "update", id: editId, full_name: form.full_name, mobile: form.mobile, email: form.email, permissions: form.permissions });
      if (ok && form.password) await post({ action: "password", id: editId, password: form.password });
      if (ok) { setMsg("User updated."); reset(); }
    } else {
      const ok = await post({ action: "create", full_name: form.full_name, username: form.username, password: form.password, mobile: form.mobile, email: form.email, permissions: form.permissions });
      if (ok) { setMsg("User created."); reset(); }
    }
  }

  const toggle = (k: string) => setForm((f: any) => ({ ...f, permissions: { ...f.permissions, [k]: !f.permissions[k] } }));

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr>
            <th className="th">Name</th><th className="th">Username</th><th className="th">Contact</th><th className="th">Role</th><th className="th">Status</th><th className="th">Actions</th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="td font-medium">{u.full_name}</td>
                <td className="td font-mono text-xs">{u.username}</td>
                <td className="td text-xs text-slate-500">{u.mobile ?? "—"}{u.email ? ` · ${u.email}` : ""}</td>
                <td className="td">{u.is_owner ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Owner</span> : <span className="text-slate-500">Staff</span>}</td>
                <td className="td"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>{u.status}</span></td>
                <td className="td whitespace-nowrap">
                  {u.is_owner ? <span className="text-xs text-slate-400">Managed by Vista</span> : (
                    <>
                      <button onClick={() => startEdit(u)} className="text-brand hover:underline">Edit</button>
                      <button disabled={busy} onClick={() => post({ action: "update", id: u.id, full_name: u.full_name, mobile: u.mobile, email: u.email, status: u.status === "active" ? "inactive" : "active", permissions: null })} className="ml-3 text-slate-600 hover:underline">{u.status === "active" ? "Deactivate" : "Activate"}</button>
                      <button disabled={busy} onClick={() => { if (confirm(`Delete ${u.full_name}?`)) post({ action: "delete", id: u.id }); }} className="ml-3 text-red-600 hover:underline">Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No users yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <form onSubmit={submit} className="card space-y-3">
        <h2 className="font-semibold text-slate-800">{editId ? "Edit User" : "Add Staff User"}</h2>
        {err && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        {msg && <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="label">Full name *</label><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
          <div><label className="label">Username {editId ? "" : "*"}</label><input className="input font-mono" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={!!editId} required={!editId} /></div>
          <div><label className="label">Mobile</label><input className="input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
          <div><label className="label">Email</label><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="label">{editId ? "New password (optional)" : "Password *"}</label><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" required={!editId} /></div>
        </div>

        <div>
          <label className="label">Permissions</label>
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            {grantable.map((g) => (
              <div key={g.module}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.module}</p>
                <div className="flex flex-wrap gap-2">
                  {g.perms.map((p) => (
                    <button type="button" key={p.key} onClick={() => toggle(p.key)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.permissions[p.key] ? "border-brand bg-brand/10 text-brand" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                      {form.permissions[p.key] ? "✓ " : ""}{p.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {grantable.length === 0 && <p className="text-sm text-slate-400">You have no grantable permissions.</p>}
          </div>
        </div>

        <div className="flex gap-2">
          <button disabled={busy} className="btn">{busy ? "Saving…" : editId ? "Save Changes" : "+ Create User"}</button>
          {editId && <button type="button" onClick={reset} className="btn-outline">Cancel</button>}
        </div>
      </form>
    </div>
  );
}
