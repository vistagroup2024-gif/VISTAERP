"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ALL_ROLES = [
  { value: "admin",      label: "Admin",       desc: "Full system access" },
  { value: "accounting", label: "Accountant",  desc: "GL, AR, AP, P&L, Balance Sheet" },
  { value: "sales",      label: "Sales",       desc: "Orders, invoices, service catalog" },
  { value: "purchase",   label: "Purchase",    desc: "Supplier bills and payments" },
  { value: "hr",         label: "HR",          desc: "Employee records (future)" },
  { value: "inventory",  label: "Inventory",   desc: "Stock management (future)" },
  { value: "hotel_ops",  label: "Hotel Ops",   desc: "Hotels, allotments, rooms" },
];

export default function NewUserPage() {
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState({
    username: "",
    password: "",
    full_name: "",
  });
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleRole(role: string) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.username.trim()) return setError("Username is required");
    if (form.password.length < 6) return setError("Password must be at least 6 characters");
    if (selectedRoles.length === 0) return setError("Select at least one role");

    setSaving(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc("create_staff_user", {
      p_username: form.username.trim().toLowerCase(),
      p_password: form.password,
      p_full_name: form.full_name.trim() || form.username.trim(),
      p_roles: selectedRoles,
    });

    setSaving(false);
    if (rpcError) return setError(rpcError.message);
    router.push("/settings/users");
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">New Staff User</h1>
      <form onSubmit={save} className="space-y-5">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

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
          <div>
            <label className="label">Full name</label>
            <input
              className="input"
              placeholder="Ahmed Ali"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              placeholder="Min. 6 characters"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Assign Roles</h2>
          <p className="text-xs text-slate-400">Select one or more roles. Each role grants access to its module.</p>
          {ALL_ROLES.map((r) => (
            <label
              key={r.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                selectedRoles.includes(r.value)
                  ? "border-brand bg-brand/5"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={selectedRoles.includes(r.value)}
                onChange={() => toggleRole(r.value)}
              />
              <div>
                <p className="font-medium text-sm">{r.label}</p>
                <p className="text-xs text-slate-400">{r.desc}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Creating…" : "Create user"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
