"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import StaffPermissionPicker from "@/components/StaffPermissionPicker";
import PageHeader from "@/components/PageHeader";
import FormSection, { Field } from "@/components/ui/FormSection";

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
      <PageHeader title="New Staff User" subtitle="Create a login and set module permissions" />
      <form onSubmit={save} className="space-y-6">
        {error && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{error}</div>}

        <div className="card space-y-6">
          <FormSection title="Account Details">
            <Field label="Username (login ID)" full hint="User will log in with this username — no email needed.">
              <input
                className="input"
                placeholder="e.g. ahmed.ali"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
              />
            </Field>
            <Field label="Full name">
              <input className="input" placeholder="Ahmed Ali" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Mobile">
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Department">
              <input className="input" placeholder="Operations / Visa / Finance" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </Field>
            <Field label="Designation">
              <input className="input" placeholder="Officer / Manager" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
            </Field>
            <Field label="Password">
              <input className="input" type="password" placeholder="Min. 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </Field>
            <Field label="Confirm password">
              <input className="input" type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />
            </Field>
          </FormSection>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Permissions</h2>
          <p className="text-xs text-slate-400">Grant access to each module and action. Leave everything unchecked to give full access (restrictions apply only once at least one box is ticked).</p>
          <StaffPermissionPicker value={perms} onChange={setPerms} />
        </div>

        <div className="flex gap-2 border-t border-slate-100 pt-4">
          <button className="btn" disabled={saving}>{saving ? "Creating…" : "Create user"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
