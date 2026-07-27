"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

interface Ref { id: string; name: string }
interface Expense { id: string; category: string; amount: number; currency: string; spent_on: string; vehicle_id: string | null; driver_id: string | null; note: string | null }

const CATS = ["fuel", "toll", "parking", "maintenance", "fine", "other"];
const today = () => new Date().toISOString().slice(0, 10);
const BLANK = () => ({ category: "fuel", amount: "", spent_on: today(), vehicle_id: "", driver_id: "", note: "" });

export default function ExpenseManager({ initial, vehicles, drivers }: { initial: Expense[]; vehicles: Ref[]; drivers: Ref[] }) {
  const router = useRouter();
  const supabase = createClient();
  const vName = new Map(vehicles.map((v) => [v.id, v.name]));
  const dName = new Map(drivers.map((d) => [d.id, d.name]));
  const [form, setForm] = useState(BLANK());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cat, setCat] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("transport_expenses").insert({
      company_id: COMPANY_ID, category: form.category, amount: Number(form.amount), spent_on: form.spent_on,
      vehicle_id: form.vehicle_id || null, driver_id: form.driver_id || null, note: form.note.trim() || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setForm(BLANK()); router.refresh();
  }
  async function del(id: string) { if (!confirm("Delete this expense?")) return; await supabase.from("transport_expenses").delete().eq("id", id); router.refresh(); }

  const rows = cat ? initial.filter((e) => e.category === cat) : initial;
  const total = useMemo(() => rows.reduce((s, e) => s + Number(e.amount || 0), 0), [rows]);

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div><label className="label">Category</label><select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></div>
        <div><label className="label">Amount (SAR) *</label><input className="input" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></div>
        <div><label className="label">Date</label><input className="input" type="date" value={form.spent_on} onChange={(e) => setForm({ ...form, spent_on: e.target.value })} /></div>
        <div><label className="label">Vehicle</label><select className="input" value={form.vehicle_id} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <div><label className="label">Driver</label><select className="input" value={form.driver_id} onChange={(e) => setForm({ ...form, driver_id: e.target.value })}><option value="">—</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        <div className="flex items-end"><button className="btn w-full" disabled={busy}>{busy ? "…" : "+ Add"}</button></div>
        <div className="sm:col-span-6"><label className="label">Note</label><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
        {err && <p className="text-sm text-red-600 sm:col-span-6">{err}</p>}
      </form>

      <div className="flex items-center gap-2">
        <select className="input max-w-[10rem]" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <span className="ml-auto text-sm font-semibold text-slate-700">Total: {total.toFixed(2)} SAR</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="th">Date</th><th className="th">Category</th><th className="th">Amount</th><th className="th">Vehicle</th><th className="th">Driver</th><th className="th">Note</th><th className="th"></th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="td">{e.spent_on}</td>
                <td className="td capitalize">{e.category}</td>
                <td className="td">{Number(e.amount).toFixed(2)} {e.currency}</td>
                <td className="td">{e.vehicle_id ? vName.get(e.vehicle_id) ?? "—" : "—"}</td>
                <td className="td">{e.driver_id ? dName.get(e.driver_id) ?? "—" : "—"}</td>
                <td className="td">{e.note ?? "—"}</td>
                <td className="td"><button onClick={() => del(e.id)} className="text-sm text-red-600 hover:underline">Delete</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No expenses.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
