"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SearchSelect from "@/components/ui/SearchSelect";
import { sar } from "../lib";
import { dateStr } from "@/lib/format";
import FormSection, { Field } from "@/components/ui/FormSection";
import { todaySA } from "@/lib/saudiTime";

type VehicleOpt = {
  kind: "vehicle" | "po_line"; id: string | null; po_line: string | null;
  label: string; cost: number; status: string; grp: string;
};
type Head = { id: string; name: string; amount: number | null; credit_account: string | null };
type Acct = { id: string; name: string; code: string; subtype: string };
type Row = {
  id: string; expense_name: string; expense_date: string; amount: number;
  narration: string | null; reference: string | null;
  vehicle: { vehicle_no: string; make: string | null; model: string | null; model_year: number | null; plate_no: string | null } | null;
};

const today = () => todaySA();
// The picker holds one value for two kinds of thing, so the key says which:
// "v:<id>" is a car in the yard, "p:<line>" is one still on a purchase order.
const blank = () => ({ pick: "", expense_id: "", expense_date: today(), amount: "", credit_account: "", narration: "" });

export default function CarExpenseForm({ vehicles, heads, accounts, rows }: {
  vehicles: VehicleOpt[]; heads: Head[]; accounts: Acct[]; rows: Row[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [f, setF] = useState(blank());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const keyOf = (v: VehicleOpt) => (v.kind === "vehicle" ? `v:${v.id}` : `p:${v.po_line}`);
  const vehicle = useMemo(() => vehicles.find((v) => keyOf(v) === f.pick) ?? null, [vehicles, f.pick]);
  const amount = Number(f.amount) || 0;
  const headAmount = Number(heads.find((h) => h.id === f.expense_id)?.amount ?? 0) || 0;
  const headVendor = heads.find((h) => h.id === f.expense_id)?.credit_account ?? null;
  const groups = useMemo(() => {
    const m = new Map<string, VehicleOpt[]>();
    for (const v of vehicles) { if (!m.has(v.grp)) m.set(v.grp, []); m.get(v.grp)!.push(v); }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [vehicles]);

  // Choosing a head brings its amount AND its vendor over from Masters —
  // "registration = 1,200, paid to the traffic department" is typed once,
  // there, rather than remembered here every time. Both stay editable: the
  // master holds the usual case, not the only one. Changing the head REPLACES
  // them rather than leaving the last head's behind, which is the whole point
  // of them coming from the master.
  function pickHead(id: string) {
    const h = heads.find((x) => x.id === id);
    setF((c) => ({
      ...c, expense_id: id,
      amount: h?.amount ? String(h.amount) : "",
      credit_account: h?.credit_account ?? "",
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setDone(null);
    const { error } = await supabase.rpc("car_expense_save", {
      p_id: null,
      p_header: {
        // A car still on order has no vehicle record; the routine makes one.
        vehicle_id: f.pick.startsWith("v:") ? f.pick.slice(2) : null,
        po_line_id: f.pick.startsWith("p:") ? f.pick.slice(2) : null,
        expense_id: f.expense_id, expense_date: f.expense_date,
        amount: String(amount), credit_account: f.credit_account || null, narration: f.narration || null,
      },
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setDone(`${sar(amount)} added to the vehicle's cost`);
    // A car on order becomes a car in the yard the moment the first expense is
    // booked against it, so the key it was picked by is gone. Start clean.
    setF({ ...blank(), pick: f.pick.startsWith("v:") ? f.pick : "" });
    router.refresh();
  }

  async function del(id: string) {
    if (!confirm("Delete this car expense? Its ledger entry is voided and the vehicle's cost goes back down.")) return;
    const { error } = await supabase.rpc("car_expense_delete", { p_id: id });
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Car Expense</h1>
        <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-brand">car sales</span>
        {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">{done}</span>}
      </div>
      <p className="text-sm text-slate-500">
        A cost that lands on a vehicle after it is bought — registration, insurance, transport, customs.
        It capitalises into Vehicle Inventory and adds to that car&apos;s Total Cost, which is what the
        quotation quotes its margin on.
      </p>

      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <form onSubmit={save} className="card space-y-6">
        <FormSection title="Expense" cols={3}>
          <Field label="Vehicle" required full
            hint="Cars in the yard, and cars still on a purchase order — customs and transport are billed long before the car turns up.">
            <SearchSelect required value={f.pick} onChange={(v) => setF({ ...f, pick: v })}
              options={groups.flatMap(([g, list]) =>
                list.map((v) => ({ value: keyOf(v), label: v.label, group: g.replace(/^\d\s/, "") })))} />
            {vehicle && (
              <p className="mt-1 text-xs text-slate-500">
                {vehicle.status === "on_order" ? (
                  <>Still on order — saving this makes its vehicle record, and the Purchase Voucher
                     fills the rest in when the car arrives.</>
                ) : (
                  <>Cost so far <b className="tabular-nums">{sar(vehicle.cost)}</b>
                    {amount > 0 && <> → <b className="tabular-nums text-brand">{sar(vehicle.cost + amount)}</b></>}</>
                )}
              </p>
            )}
          </Field>
          <Field label="Expense Head" required>
            <SearchSelect required value={f.expense_id} onChange={pickHead}
              options={heads.map((h) => ({ value: h.id, label: h.name }))} />
            {heads.length === 0 && <p className="mt-1 text-xs text-amber-600">No heads yet — add them in Masters → Car Purchase Expense.</p>}
          </Field>
          <Field label="Date">
            <input type="date" className="input" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} />
          </Field>
          <Field label="Amount (SAR)" required
            hint={headAmount > 0 ? `Masters has ${sar(headAmount)} for this head — change it if this bill differs.` : undefined}>
            <input required type="number" step="0.01" min="0.01" className="input text-right tabular-nums"
              value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          {/* The vehicle is debited — the cost lands on the car — so the other
              side is credited, and the other side is whoever we owe or whoever
              paid. That is what this field has always been; it was named after
              the wrong side of the entry. */}
          <Field label="Vendor (credited)" full
            hint={headVendor
              ? "Filled in from the expense head in Masters — change it for a bill that came from somewhere else."
              : "Who is owed, or the cash/bank that settled it. Left empty it sits on Vehicle Supplier Payable."}>
            <SearchSelect value={f.credit_account} onChange={(v) => setF({ ...f, credit_account: v })}
              placeholder="— Vehicle Supplier Payable —"
              options={accounts.map((a) => ({ value: a.id, label: a.name, hint: a.subtype ?? undefined }))} />
          </Field>
          <Field label="Narration" full>
            <input className="input" value={f.narration} onChange={(e) => setF({ ...f, narration: e.target.value })} />
          </Field>
        </FormSection>

        <div className="flex gap-2 border-t border-slate-100 pt-4">
          <button className="btn disabled:opacity-40" disabled={busy || !f.pick || !f.expense_id || amount <= 0}>
            {busy ? "Saving…" : "Save & Post"}
          </button>
          <button type="button" className="btn-outline" onClick={() => setF(blank())}>Clear</button>
        </div>
      </form>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-800">Recent car expenses</h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr>
              <th className="th">Voucher</th><th className="th">Date</th><th className="th">Vehicle</th>
              <th className="th">Head</th><th className="th text-right">Amount</th><th className="th">Narration</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="td font-mono text-xs">{r.reference ?? "—"}</td>
                  <td className="td">{dateStr(r.expense_date)}</td>
                  <td className="td">
                    {[r.vehicle?.make, r.vehicle?.model, r.vehicle?.model_year].filter(Boolean).join(" ") || r.vehicle?.vehicle_no || "—"}
                    {r.vehicle?.plate_no && <span className="ml-1 text-xs text-slate-400">{r.vehicle.plate_no}</span>}
                  </td>
                  <td className="td">{r.expense_name}</td>
                  <td className="td text-right tabular-nums">{sar(r.amount)}</td>
                  <td className="td text-slate-500">{r.narration ?? ""}</td>
                  <td className="td text-right">
                    <button onClick={() => del(r.id)} className="text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No car expenses yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
