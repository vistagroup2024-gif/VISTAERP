"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { useDocRights } from "@/components/AccessProvider";

type Emp = {
  id: string; emp_code: string | null; name: string; department: string | null; designation: string | null;
  join_date: string | null; basic_salary: number; allowances: number; deductions: number;
  bank_name: string | null; bank_account: string | null; iqama_no: string | null; iqama_expiry: string | null; status: string;
};
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const blank = () => ({ emp_code: "", name: "", department: "", designation: "", join_date: "", basic_salary: "", allowances: "", deductions: "", bank_name: "", bank_account: "", iqama_no: "", iqama_expiry: "" });

export default function EmployeeManager({ initial }: { initial: Emp[] }) {
  const rights = useDocRights("employees");
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState<Record<string, string>>(blank());
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!form.name.trim()) return setErr("Name is required");
    setBusy(true);
    const payload: any = {
      emp_code: form.emp_code || null, name: form.name.trim(), department: form.department || null, designation: form.designation || null,
      join_date: form.join_date || null, basic_salary: Number(form.basic_salary) || 0, allowances: Number(form.allowances) || 0,
      deductions: Number(form.deductions) || 0, bank_name: form.bank_name || null, bank_account: form.bank_account || null,
      iqama_no: form.iqama_no || null, iqama_expiry: form.iqama_expiry || null,
    };
    const { error } = editId
      ? await supabase.from("employees").update(payload).eq("id", editId)
      : await supabase.from("employees").insert({ company_id: COMPANY_ID, ...payload });
    setBusy(false);
    if (error) return setErr(error.message);
    setForm(blank()); setEditId(null); router.refresh();
  }
  function edit(m: Emp) {
    setEditId(m.id);
    setForm({ emp_code: m.emp_code ?? "", name: m.name, department: m.department ?? "", designation: m.designation ?? "",
      join_date: m.join_date ?? "", basic_salary: String(m.basic_salary), allowances: String(m.allowances), deductions: String(m.deductions),
      bank_name: m.bank_name ?? "", bank_account: m.bank_account ?? "", iqama_no: m.iqama_no ?? "", iqama_expiry: m.iqama_expiry ?? "" });
  }
  async function toggle(m: Emp) { await supabase.from("employees").update({ status: m.status === "active" ? "inactive" : "active" }).eq("id", m.id); router.refresh(); }
  async function del(m: Emp) { if (!confirm(`Delete ${m.name}?`)) return; await supabase.from("employees").delete().eq("id", m.id); router.refresh(); }

  const fields: [string, string, string?, string?][] = [
    ["name", "Name *", "text", "col-span-2"], ["emp_code", "Code", "text"],
    ["department", "Department", "text"], ["designation", "Designation", "text"], ["join_date", "Join date", "date"],
    ["basic_salary", "Basic salary", "number"], ["allowances", "Allowances", "number"], ["deductions", "Deductions", "number"],
    ["iqama_no", "Iqama no.", "text"], ["iqama_expiry", "Iqama expiry", "date"], ["bank_name", "Bank", "text"], ["bank_account", "Bank account", "text"],
  ];

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="card grid grid-cols-2 gap-3 md:grid-cols-4">
        {fields.map(([k, label, type = "text", col]) => (
          <div key={k} className={col}><label className="label">{label}</label>
            <input className="input" type={type} step={type === "number" ? "any" : undefined} value={form[k]} onChange={(e) => set(k, e.target.value)} /></div>
        ))}
        <div className="col-span-2 flex items-end gap-2">
          <button className="btn disabled:opacity-40" disabled={busy || !(editId ? rights.canEdit : rights.canCreate)} title={rights.denied(editId ? "edit" : "create")}>{busy ? "…" : editId ? "Save changes" : "+ Add employee"}</button>
          {editId && <button type="button" onClick={() => { setEditId(null); setForm(blank()); }} className="btn-outline">Cancel</button>}
        </div>
        {err && <p className="col-span-full text-sm text-red-600">{err}</p>}
      </form>

      <div className="card overflow-x-auto p-0 text-sm">
        <table className="w-full">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-left">Designation</th>
              <th className="px-3 py-2 text-right">Basic</th><th className="px-3 py-2 text-right">Allow.</th><th className="px-3 py-2 text-right">Deduct.</th>
              <th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2 text-center">Status</th><th /></tr>
          </thead>
          <tbody>
            {initial.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{m.name}{m.emp_code ? <span className="text-slate-400"> · {m.emp_code}</span> : null}</td>
                <td className="px-3 py-2 text-slate-600">{m.designation ?? "—"}{m.department ? ` · ${m.department}` : ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(m.basic_salary)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(m.allowances)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(m.deductions)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{money(m.basic_salary + m.allowances - m.deductions)}</td>
                <td className="px-3 py-2 text-center"><button onClick={() => toggle(m)} disabled={!rights.canEdit} title={rights.denied("edit")} className={`rounded-full px-2 py-0.5 text-xs disabled:opacity-50 ${m.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>{m.status}</button></td>
                <td className="px-3 py-2 whitespace-nowrap text-right">
                  <button onClick={() => edit(m)} disabled={!rights.canEdit} title={rights.denied("edit")} className="text-brand hover:underline disabled:opacity-40">Edit</button>
                  <button onClick={() => del(m)} disabled={!rights.canDelete} title={rights.denied("delete")} className="ml-3 text-red-600 hover:underline disabled:opacity-40">Delete</button>
                </td>
              </tr>
            ))}
            {initial.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">No employees yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
