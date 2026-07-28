"use client";

import { STAFF_PERMISSION_CATALOG } from "@/lib/staffPermissions";

// Checkbox grid for internal-staff permissions. `value` is a {key:true} map.
export default function StaffPermissionPicker({
  value, onChange,
}: { value: Record<string, boolean>; onChange: (v: Record<string, boolean>) => void }) {
  function toggle(key: string) {
    const next = { ...value };
    if (next[key]) delete next[key]; else next[key] = true;
    onChange(next);
  }
  function setModule(keys: string[], on: boolean) {
    const next = { ...value };
    keys.forEach((k) => { if (on) next[k] = true; else delete next[k]; });
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {STAFF_PERMISSION_CATALOG.map((g) => {
        const keys = g.perms.map((p) => p.key);
        const all = keys.every((k) => value[k]);
        return (
          <div key={g.module} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">{g.module}</h3>
              <button type="button" onClick={() => setModule(keys, !all)} className="text-xs text-brand hover:underline">
                {all ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {g.perms.map((p) => (
                <label key={p.key} className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={!!value[p.key]} onChange={() => toggle(p.key)} />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
