"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import StaffPermissionPicker from "@/components/StaffPermissionPicker";

const ALL_ROLES = [
  { value: "admin", label: "Admin", desc: "Full system access" },
  { value: "accounting", label: "Accountant", desc: "GL, AR, AP, P&L, Balance Sheet" },
  { value: "sales", label: "Sales", desc: "Orders, invoices, service catalog" },
  { value: "purchase", label: "Purchase", desc: "Supplier bills and payments" },
  { value: "hr", label: "HR", desc: "Employee records" },
  { value: "inventory", label: "Inventory", desc: "Stock management" },
  { value: "hotel_ops", label: "Hotel Ops", desc: "Hotels, allotments, rooms" },
];

interface Props {
  userId: string; fullName: string; isActive: boolean;
  email: string; phone: string; department: string; designation: string;
  currentPerms: Record<string, boolean>; currentRoles: string[];
}

export default function EditUserRoles({
  userId, fullName: initialName, isActive: initialActive, email: iEmail, phone: iPhone,
  department: iDept, designation: iDesig, currentPerms, currentRoles,
}: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [f, setF] = useState({ fullName: initialName, email: iEmail, phone: iPhone, department: iDept, designation: iDesig });
  const [isActive, setIsActive] = useState(initialActive);
  const [selectedRoles, setSelectedRoles] = useState<string[]>(currentRoles);
  const [perms, setPerms] = useState<Record<string, boolean>>(currentPerms ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [newPass, setNewPass] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  function toggleRole(role: string) {
    setSelectedRoles((prev) => prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null); setSuccess(false);
    const { error: err } = await supabase.rpc("update_staff_user", {
      p_id: userId, p_full_name: f.fullName, p_email: f.email, p_phone: f.phone,
      p_department: f.department, p_designation: f.designation, p_is_active: isActive,
      p_roles: selectedRoles, p_permissions: perms,
    });
    setSaving(false);
    if (err) return setError(err.message);
    setSuccess(true);
    router.refresh();
  }

  async function resetPassword() {
    setPwMsg(null);
    if (newPass.length < 6) return setPwMsg("Password must be at least 6 characters");
    const { error: err } = await supabase.rpc("reset_staff_password", { p_id: userId, p_password: newPass });
    if (err) return setPwMsg(err.message);
    setNewPass(""); setPwMsg("Password reset.");
  }

  return (
    <form onSubmit={save} className="space-y-5">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</div>}

      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Account Details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="label">Full name</label><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
          <div><label className="label">Email</label><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div><label className="label">Mobile</label><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div><label className="label">Department</label><input className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></div>
          <div><label className="label">Designation</label><input className="input" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></div>
        </div>
        <div className="flex items-center gap-3">
          <input id="active" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
          <label htmlFor="active" className="text-sm font-medium text-slate-700">Account active (can log in)</label>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-700">Base Roles</h2>
        <p className="text-xs text-slate-400">Roles grant underlying data access. Fine-grained menu/action control is set in Permissions below.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ALL_ROLES.map((r) => (
            <label key={r.value} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 transition ${selectedRoles.includes(r.value) ? "border-brand bg-brand/5" : "border-slate-200 hover:bg-slate-50"}`}>
              <input type="checkbox" className="mt-0.5" checked={selectedRoles.includes(r.value)} onChange={() => toggleRole(r.value)} />
              <div><p className="text-sm font-medium">{r.label}</p><p className="text-xs text-slate-400">{r.desc}</p></div>
            </label>
          ))}
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-700">Permissions</h2>
        <p className="text-xs text-slate-400">Leave everything unchecked for full access; ticking any box switches this user to restricted access.</p>
        <StaffPermissionPicker value={perms} onChange={setPerms} />
      </div>

      <div className="flex gap-2">
        <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
        <button type="button" className="btn-outline" onClick={() => router.push("/settings/users")}>Back to users</button>
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold text-slate-700">Reset Password</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="label">New password</label><input className="input" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="Min. 6 characters" /></div>
          <button type="button" onClick={resetPassword} className="btn-outline text-sm">Reset password</button>
          {pwMsg && <span className="text-sm text-slate-600">{pwMsg}</span>}
        </div>
      </div>
    </form>
  );
}
