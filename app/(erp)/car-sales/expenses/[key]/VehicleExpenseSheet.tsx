"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SearchSelect from "@/components/ui/SearchSelect";
import { sar } from "../../lib";
import { dateStr } from "@/lib/format";
import FormSection, { Field } from "@/components/ui/FormSection";
import { todaySA } from "@/lib/saudiTime";
import Link from "next/link";

type VehicleOpt = {
  kind: "vehicle" | "po_line"; id: string | null; po_line: string | null;
  label: string; cost: number; status: string; grp: string;
  item: string | null; supplier: string | null; source: string | null;
  cost_center: string | null; tag_area: string | null;
};
type Head = { id: string; name: string; amount: number | null; credit_account: string | null };
type Acct = { id: string; name: string; code: string; subtype: string };
type Row = {
  id: string; vehicle_id: string; expense_id: string | null; credit_account: string | null;
  expense_name: string; expense_date: string; amount: number;
  narration: string | null; reference: string | null;
};

const today = () => todaySA();
const blank = () => ({ expense_id: "", expense_date: today(), amount: "", credit_account: "", narration: "" });

export default function VehicleExpenseSheet({ vkey, vehicle, heads, accounts, rows, rights }: {
  vkey: string; vehicle: VehicleOpt; heads: Head[]; accounts: Acct[]; rows: Row[];
  rights: Record<string, boolean>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [f, setF] = useState(blank());
  // null while adding a new line; a row's id while reopening one already on the sheet.
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const amount = Number(f.amount) || 0;
  // Reopening one, its old amount is already inside the car's cost, so the
  // "after" figure has to take it back out before adding the new one.
  const wasAmount = editing ? Number(rows.find((r) => r.id === editing)?.amount ?? 0) : 0;
  const headAmount = Number(heads.find((h) => h.id === f.expense_id)?.amount ?? 0) || 0;
  const headVendor = heads.find((h) => h.id === f.expense_id)?.credit_account ?? null;
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  function pickHead(id: string) {
    const h = heads.find((x) => x.id === id);
    setF((c) => ({
      ...c, expense_id: id,
      amount: h?.amount ? String(h.amount) : "",
      credit_account: h?.credit_account ?? "",
    }));
  }

  function edit(r: Row) {
    setEditing(r.id); setErr(null); setDone(null);
    setF({
      expense_id: r.expense_id ?? "",
      expense_date: r.expense_date,
      amount: String(r.amount),
      credit_account: r.credit_account ?? "",
      narration: r.narration ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancel() { setEditing(null); setF(blank()); setErr(null); setDone(null); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setDone(null);
    const { data: newId, error } = await supabase.rpc("car_expense_save", {
      p_id: editing,
      p_header: {
        vehicle_id: vehicle.kind === "vehicle" ? vehicle.id : null,
        // A car still on order has no vehicle record; the routine makes one —
        // and reuses it on every later add against the same PO line.
        po_line_id: vehicle.kind === "po_line" ? vehicle.po_line : null,
        expense_id: f.expense_id, expense_date: f.expense_date,
        amount: String(amount), credit_account: f.credit_account || null, narration: f.narration || null,
      },
    });
    if (error) { setBusy(false); return setErr(error.message); }

    // The first expense on a car still on order makes its vehicle record, so
    // the "p:<line>" this sheet was opened under no longer resolves it —
    // car_expense_vehicle_options now offers it as "v:<id>" instead. Follow it.
    if (!editing && vehicle.kind === "po_line") {
      const { data: exp } = await supabase.from("car_vehicle_expenses")
        .select("vehicle_id").eq("id", newId).single();
      if (exp?.vehicle_id) {
        router.replace(`/car-sales/expenses/${encodeURIComponent("v:" + exp.vehicle_id)}`);
        router.refresh();
        return;
      }
    }

    setBusy(false);
    setDone(editing
      ? `Updated — ${sar(amount)} on this line`
      : `${sar(amount)} added to the sheet`);
    setF(blank());
    setEditing(null);
    router.refresh();
  }

  async function del(id: string) {
    if (!confirm("Delete this line? Its ledger entry is voided and the vehicle's cost goes back down.")) return;
    const { error } = await supabase.rpc("car_expense_delete", { p_id: id });
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/car-sales/expenses" className="text-sm text-brand hover:underline">← Car Expense</Link>
      </div>
      <div className="card space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{vehicle.label}</h1>
          {vehicle.status === "on_order"
            ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">Not yet received</span>
            : <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-brand">{vehicle.status}</span>}
        </div>
        <p className="text-sm text-slate-500">
          {vehicle.status === "on_order"
            ? "Still on order — the first expense below makes its vehicle record; the Purchase Voucher fills the rest in when the car arrives."
            : <>{rows.length} line{rows.length === 1 ? "" : "s"} so far, <b className="tabular-nums">{sar(total)}</b>,
                {" "}in a total cost of <b className="tabular-nums">{sar(vehicle.cost)}</b>.</>}
        </p>
        {/* Which car this actually is, beyond its bare vehicle number: what it
            was bought as, who from, and which Purchase Order or Purchase
            Voucher raised it — plus the cost centre and tag area its ledger
            entry carries, so a plain "CAR-000006" is traceable from here. */}
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-3">
          {vehicle.item && <div><dt className="inline text-slate-400">Item: </dt><dd className="inline text-slate-700">{vehicle.item}</dd></div>}
          {vehicle.source && <div><dt className="inline text-slate-400">From: </dt><dd className="inline text-slate-700">{vehicle.source}</dd></div>}
          {vehicle.supplier && <div><dt className="inline text-slate-400">Supplier: </dt><dd className="inline text-slate-700">{vehicle.supplier}</dd></div>}
          {vehicle.cost_center && <div><dt className="inline text-slate-400">Cost Centre: </dt><dd className="inline text-slate-700">{vehicle.cost_center}</dd></div>}
          {vehicle.tag_area && <div><dt className="inline text-slate-400">Tag Area: </dt><dd className="inline text-slate-700">{vehicle.tag_area}</dd></div>}
        </dl>
      </div>

      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">{done}</span>}

      {(rights.create || editing) && (
        <form onSubmit={save} className="card space-y-6">
          <FormSection title={editing ? "Edit expense" : "Add expense"} cols={3}>
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
              {amount > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  Cost → <b className="tabular-nums text-brand">{sar(vehicle.cost - wasAmount + amount)}</b>
                </p>
              )}
            </Field>
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

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <button className="btn disabled:opacity-40"
              disabled={busy || !f.expense_id || amount <= 0 || !(editing ? rights.edit : rights.create)}>
              {busy ? "Saving…" : editing ? "Update & Repost" : "+ Add Expense"}
            </button>
            <button type="button" className="btn-outline" onClick={cancel}>{editing ? "Cancel" : "Clear"}</button>
            {editing && (
              <span className="text-xs text-slate-500">
                Saving voids this line&apos;s ledger entry and raises a new one.
              </span>
            )}
          </div>
        </form>
      )}
      {!rights.create && !editing && (
        <p className="text-xs text-slate-500">You do not have create rights on this screen.</p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-800">Expenses on this sheet</h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr>
              <th className="th">Voucher</th><th className="th">Date</th>
              <th className="th">Head</th><th className="th text-right">Amount</th><th className="th">Narration</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="td font-mono text-xs">{r.reference ?? "—"}</td>
                  <td className="td">{dateStr(r.expense_date)}</td>
                  <td className="td">{r.expense_name}</td>
                  <td className="td text-right tabular-nums">{sar(r.amount)}</td>
                  <td className="td text-slate-500">{r.narration ?? ""}</td>
                  <td className="td text-right whitespace-nowrap">
                    {rights.edit && (
                      <button onClick={() => edit(r)} className="text-brand hover:underline">Edit</button>
                    )}
                    {rights.edit && rights.delete && <span className="mx-2 text-slate-300">|</span>}
                    {rights.delete && (
                      <button onClick={() => del(r.id)} className="text-red-500 hover:underline">Delete</button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>Nothing on this sheet yet — add the first expense above.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
