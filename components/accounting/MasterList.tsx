"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { useDocRights } from "@/components/AccessProvider";

// Several masters share this list; the Access tab names them separately, so the
// screen whose rights apply is the one whose table is being edited.
const TABLE_DOC: Record<string, string> = {
  currencies: "currencies",
  acct_car_purchase_expenses: "car_expenses",
  warehouses: "warehouses",
};

export type MasterField = { key: string; label: string; type?: "text" | "number"; width?: string; required?: boolean };

// Reusable CRUD list for a simple accounting master (cost centers, tag areas,
// car-purchase expenses, currencies…). Server passes the initial rows; this
// component adds / edits inline / toggles active / deletes and refreshes.
export default function MasterList({
  table, pk = "id", fields, initial, companyScoped = true, hasActive = true, note,
}: {
  table: string; pk?: string; fields: MasterField[]; initial: any[];
  companyScoped?: boolean; hasActive?: boolean; note?: string;
}) {
  const rights = useDocRights(TABLE_DOC[table] ?? "");
  const router = useRouter();
  const supabase = createClient();
  const blank = () => Object.fromEntries(fields.map((f) => [f.key, ""]));
  const [form, setForm] = useState<Record<string, string>>(blank());
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const coerce = (obj: Record<string, string>) => {
    const out: any = {};
    for (const f of fields) {
      const v = (obj[f.key] ?? "").toString().trim();
      out[f.key] = f.type === "number" ? (v === "" ? 0 : Number(v)) : (v === "" ? null : v);
    }
    return out;
  };

  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    const first = fields.find((f) => f.required !== false);
    if (first && !(form[first.key] ?? "").trim()) return setErr(`${first.label} is required`);
    setBusy(true);
    const payload = { ...coerce(form), ...(companyScoped ? { company_id: COMPANY_ID } : {}) };
    const { error } = await supabase.from(table).insert(payload);
    setBusy(false);
    if (error) return setErr(error.message);
    setForm(blank()); router.refresh();
  }
  function startEdit(r: any) { setEditId(r[pk]); setEdit(Object.fromEntries(fields.map((f) => [f.key, r[f.key] ?? ""]))); }
  async function save(id: string) {
    setBusy(true); setErr(null);
    const { error } = await supabase.from(table).update(coerce(edit)).eq(pk, id);
    setBusy(false);
    if (error) return setErr(error.message);
    setEditId(null); router.refresh();
  }
  async function toggle(r: any) { await supabase.from(table).update({ is_active: !r.is_active }).eq(pk, r[pk]); router.refresh(); }
  async function del(r: any) {
    if (!confirm(`Delete "${r[fields[0].key]}"?`)) return;
    const { error } = await supabase.from(table).delete().eq(pk, r[pk]);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {note && <p className="text-sm text-slate-500">{note}</p>}
      <form onSubmit={add} className="card grid grid-cols-1 gap-3 sm:grid-cols-6">
        {fields.map((f) => (
          <div key={f.key} className={f.width ?? "sm:col-span-2"}>
            <label className="label">{f.label}{f.required !== false ? " *" : ""}</label>
            <input className="input" type={f.type === "number" ? "number" : "text"} step={f.type === "number" ? "any" : undefined}
              value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
          </div>
        ))}
        <div className="flex items-end"><button className="btn w-full disabled:opacity-40" disabled={busy || !rights.canCreate} title={rights.denied("create")}>{busy ? "…" : "+ Add"}</button></div>
        {err && <p className="text-sm text-red-600 sm:col-span-6">{err}</p>}
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr>
            {fields.map((f) => <th key={f.key} className="th text-left">{f.label}</th>)}
            {hasActive && <th className="th">Status</th>}
            <th className="th">Actions</th>
          </tr></thead>
          <tbody>
            {initial.map((r) => editId === r[pk] ? (
              <tr key={r[pk]} className="border-t border-slate-100 bg-amber-50/40">
                {fields.map((f) => (
                  <td key={f.key} className="td"><input className="input" type={f.type === "number" ? "number" : "text"} step={f.type === "number" ? "any" : undefined}
                    value={edit[f.key] ?? ""} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} /></td>
                ))}
                {hasActive && <td className="td" />}
                <td className="td whitespace-nowrap">
                  <button onClick={() => save(r[pk])} disabled={!rights.canEdit} title={rights.denied("edit")} className="text-sm font-medium text-brand hover:underline disabled:opacity-40">Save</button>
                  <button onClick={() => setEditId(null)} className="ml-3 text-sm text-slate-500 hover:underline">Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={r[pk]} className="border-t border-slate-100">
                {fields.map((f) => <td key={f.key} className="td">{f.type === "number" ? Number(r[f.key] ?? 0).toLocaleString() : (r[f.key] ?? "—")}</td>)}
                {hasActive && <td className="td">
                  <button onClick={() => toggle(r)} disabled={!rights.canEdit} title={rights.denied("edit")} className={`rounded-full px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${r.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>{r.is_active ? "Active" : "Inactive"}</button>
                </td>}
                <td className="td whitespace-nowrap">
                  <button onClick={() => startEdit(r)} disabled={!rights.canEdit} title={rights.denied("edit")} className="text-sm text-brand hover:underline disabled:opacity-40">Edit</button>
                  <button onClick={() => del(r)} disabled={!rights.canDelete} title={rights.denied("delete")} className="ml-3 text-sm text-red-600 hover:underline disabled:opacity-40">Delete</button>
                </td>
              </tr>
            ))}
            {initial.length === 0 && <tr><td className="td text-slate-400" colSpan={fields.length + (hasActive ? 2 : 1)}>Nothing yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
