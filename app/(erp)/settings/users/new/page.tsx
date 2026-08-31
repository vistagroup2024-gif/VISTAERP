"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import StaffPermissionPicker from "@/components/StaffPermissionPicker";

export default function NewUserPage() {
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState({
    username: "", password: "", confirm: "", full_name: "",
    email: "", phone: "", department: "", designation: "",
  });
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.username.trim()) return setError("Username is required");
    if (form.password.length < 6) return setError("Password must be at least 6 characters");
    if (form.password !== form.confirm) return setError("Passwords do not match");

    setSaving(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc("create_staff_user_v2", {
      p_username: form.username.trim().toLowerCase(),
      p_password: form.password,
      p_full_name: form.full_name.trim() || form.username.trim(),
      p_email: form.email.trim(),
      p_phone: form.phone.trim(),
      p_department: form.department.trim(),
      p_designation: form.designation.trim(),
      p_roles: [],
      p_permissions: perms,
    });

    setSaving(false);
    if (rpcError) return setError(rpcError.message);
    router.push("/settings/users");
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-xl font-bold tracking-tight text-slate-900">New Staff User</h1>
      <form onSubmit={save} className="space-y-5">
        {error && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{error}</div>}

        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-700">Account Details</h2>
          <div>
            <label className="label">Username (login ID)</label>
            <input
              className="input"
              placeholder="e.g. ahmed.ali"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />
            <p className="mt-1 text-xs text-slate-400">
              User will log in with this username — no email needed.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Full name</label>
              <input className="input" placeholder="Ahmed Ali" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="label">Mobile</label>
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="label">Department</label>
              <input className="input" placeholder="Operations / Visa / Finance" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
            <div>
              <label className="label">Designation</label>
              <input className="input" placeholder="Officer / Manager" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" placeholder="Min. 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </div>
            <div>
              <label className="label">Confirm password</label>
              <input className="input" type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />
            </div>
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Permissions</h2>
          <p className="text-xs text-slate-400">Grant access to each module and action. Leave everything unchecked to give full access (restrictions apply only once at least one box is ticked).</p>
          <StaffPermissionPicker value={perms} onChange={setPerms} />
        </div>

        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Creating…" : "Create user"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
