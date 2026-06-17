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

interface Props {
  userId: string;
  fullName: string;
  isActive: boolean;
  currentRoles: string[];
}

export default function EditUserRoles({ userId, fullName: initialName, isActive: initialActive, currentRoles }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [fullName, setFullName] = useState(initialName);
  const [isActive, setIsActive] = useState(initialActive);
  const [selectedRoles, setSelectedRoles] = useState<string[]>(currentRoles);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function toggleRole(role: string) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    // Update profile
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({ full_name: fullName, is_active: isActive })
      .eq("id", userId);

    if (profileErr) {
      setSaving(false);
      return setError(profileErr.message);
    }

    // Delete all existing roles for this user, re-insert selected
    await supabase.from("user_roles").delete().eq("user_id", userId);

    if (selectedRoles.length > 0) {
      const { error: rolesErr } = await supabase.from("user_roles").insert(
        selectedRoles.map((role) => ({ user_id: userId, role }))
      );
      if (rolesErr) {
        setSaving(false);
        return setError(rolesErr.message);
      }
    }

    setSaving(false);
    setSuccess(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-5">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</div>}

      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Account Details</h2>
        <div>
          <label className="label">Full name</label>
          <input
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <input
            id="active"
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="active" className="text-sm font-medium text-slate-700">
            Account active (can log in)
          </label>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-700">Roles</h2>
        <p className="text-xs text-slate-400">Each role grants access to its module. A user can hold multiple roles.</p>
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
        <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
        <button type="button" className="btn-outline" onClick={() => router.push("/settings/users")}>
          Back to users
        </button>
      </div>
    </form>
  );
}
