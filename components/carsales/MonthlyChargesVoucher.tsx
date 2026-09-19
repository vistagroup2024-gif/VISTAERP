"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr, money } from "@/lib/format";
import { todaySA } from "@/lib/saudiTime";
import SearchSelect from "@/components/ui/SearchSelect";

// The Monthly Service Charges, as a voucher: a MONTH is the document.
//
// One journal entry a month (migration 350) — a debit line per customer and
// one credit for the month's revenue — used to be reached through a flat
// register and a Generate button. This opens the month like any other
// voucher: its lines are the cars charged that month, an amount can be
// corrected or a car added or taken off, and Save rebuilds the month's entry
// from what is on the screen (car_charges_month_save, migration 377).
//
// Generate fills the month from the rule — full month from the delivery,
// prorated for the month the car was handed over — and the rule's figure is
// shown beside any line that differs from it, so a hand-corrected amount is
// visibly a correction rather than a mistake.

type Line = {
  id?: string; vehicle_id: string; vehicle: string; car: string | null; plate: string | null;
  customer: string | null; amount: string; paid: number; notes: string; delivered: string | null; rule_amount: number;
};
type Candidate = {
  vehicle_id: string; vehicle: string; car: string | null; plate: string | null; customer: string | null;
  delivered: string | null; rule_amount: number; full: number;
};
type Loaded = {
  month: string; entry_id: string | null; entry_no: string | null; entry_date: string | null;
  lines: any[]; candidates: Candidate[]; months: string[];
};

const ym = (d: string) => d.slice(0, 7);
function shiftMonth(k: string, n: number): string {
  const [y, m] = k.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
const monthName = (k: string) =>
  new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const num = (v: string) => Number(v) || 0;

export default function MonthlyChargesVoucher({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [month, setMonth] = useState(() => ym(todaySA()));
  const [data, setData] = useState<Loaded | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [addId, setAddId] = useState("");

  const load = useCallback(async (k: string) => {
    setErr(null);
    const { data: d, error } = await supabase.rpc("car_charges_month_load", { p_month: `${k}-01` });
    if (error) { setErr(error.message); return; }
    const L = d as Loaded;
    setData(L);
    setLines((L.lines ?? []).map((l: any) => ({
      ...l, amount: String(l.amount ?? ""), notes: l.notes ?? "",
      paid: Number(l.paid) || 0, rule_amount: Number(l.rule_amount) || 0,
    })));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(month); }, [month, load]);

  const total = useMemo(() => lines.reduce((s, l) => s + num(l.amount), 0), [lines]);
  const paid = useMemo(() => lines.reduce((s, l) => s + l.paid, 0), [lines]);
  const candidates = useMemo(
    () => (data?.candidates ?? []).filter((c) => !lines.some((l) => l.vehicle_id === c.vehicle_id)),
    [data, lines]);
  const months = data?.months ?? [];
  const posted = !!data?.entry_id;

  function go(k: string) {
    if (dirty && !confirm("Leave this month without saving the changes?")) return;
    setDone(null); setMonth(k);
  }
  function setLine(i: number, patch: Partial<Line>) {
    setLines((a) => a.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setDirty(true);
  }
  function addLine() {
    const c = candidates.find((x) => x.vehicle_id === addId);
    if (!c) return;
    setLines((a) => [...a, {
      vehicle_id: c.vehicle_id, vehicle: c.vehicle, car: c.car, plate: c.plate, customer: c.customer,
      amount: String(c.rule_amount > 0 ? c.rule_amount : c.full), paid: 0, notes: "",
      delivered: c.delivered, rule_amount: Number(c.rule_amount) || 0,
    }]);
    setAddId(""); setDirty(true);
  }
  function removeLine(i: number) {
    const l = lines[i];
    if (l.paid > 0) { setErr(`A payment is recorded against ${l.vehicle} — it cannot be taken off the voucher.`); return; }
    setLines((a) => a.filter((_, j) => j !== i)); setDirty(true);
  }
  async function transferOut(vehicleId: string, label: string) {
    if (!canEdit) return;
    if (!confirm(`Transfer ${label} out of Vista's name?\n\nThis stops future Monthly Service Charges for this vehicle. Charges already billed (this month and earlier) stay payable.`)) return;
    setBusy(true); setErr(null); setDone(null);
    const { error } = await supabase.rpc("car_vehicle_transfer", { p_vehicle: vehicleId, p: { transfer_date: todaySA() } });
    setBusy(false);
    if (error) return setErr(error.message);
    setDone(`${label} transferred out — Monthly Service Charges stop from here`);
    if (addId === vehicleId) setAddId("");
    await load(month);
  }
  async function generate() {
    setBusy(true); setErr(null); setDone(null);
    const { data: n, error } = await supabase.rpc("car_generate_service_charges", { p_asof: `${month}-01` });
    setBusy(false);
    if (error) return setErr(error.message);
    setDone(`${n ?? 0} charge line${Number(n) === 1 ? "" : "s"} generated from the rule — press Save to post the month`);
    await load(month);
    setDirty(true);
  }
  async function save() {
    if (!canEdit) return;
    if (!confirm(`Save ${monthName(month)}?\n\nThe month's voucher is rebuilt from these ${lines.length} line${lines.length === 1 ? "" : "s"} (${money(total, "SAR")}).`)) return;
    setBusy(true); setErr(null); setDone(null);
    const { data: r, error } = await supabase.rpc("car_charges_month_save", {
      p_month: `${month}-01`,
      p_lines: lines.map((l) => ({ vehicle_id: l.vehicle_id, amount: num(l.amount), notes: l.notes || null })),
    });
    setBusy(false);
    if (error) return setErr(error.message);
    const x = r as any;
    setDone(x?.entry_no ? `${monthName(month)} posted — voucher ${x.entry_no}` : `${monthName(month)} saved — nothing to post`);
    await load(month);
    router.refresh();
  }
  function print() { if (data?.entry_id) window.open(`/accounting/vouchers/${data.entry_id}`, "_blank"); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Monthly Charges</h1>
        {posted
          ? <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-green-700">posted · {data!.entry_no}</span>
          : <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-amber-700">not posted</span>}
        {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">{done}</span>}
      </div>

      <div className="card flex flex-wrap items-center gap-2 py-2">
        <button onClick={() => go(shiftMonth(month, -1))} disabled={busy} className="btn-outline text-sm">‹ Previous</button>
        <input type="month" className="input max-w-[11rem]" value={month} onChange={(e) => e.target.value && go(e.target.value)} />
        <button onClick={() => go(shiftMonth(month, 1))} disabled={busy} className="btn-outline text-sm">Next ›</button>
        <button onClick={() => go(ym(todaySA()))} disabled={busy} className="btn-outline text-sm">This month</button>
        {canEdit && <button onClick={generate} disabled={busy} className="btn-outline text-sm">⚙ Generate from rule</button>}
        <button onClick={print} disabled={!posted} className="btn-outline text-sm disabled:opacity-40">🖨 Print voucher</button>
        {months.length > 0 && (
          <span className="ml-auto text-xs text-slate-400">
            Months with charges: {months.map((m) => (
              <button key={m} onClick={() => go(ym(m))}
                className={`ml-1 rounded px-1.5 py-0.5 ${ym(m) === month ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {ym(m)}
              </button>
            ))}
          </span>
        )}
      </div>

      {err && <div className="rounded-md border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <div className="card space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div><label className="label">Voucher No.</label>
            <div className="input flex items-center bg-slate-50 font-mono text-slate-700">{data?.entry_no ?? "— on save —"}</div></div>
          <div><label className="label">Month</label>
            <div className="input flex items-center bg-slate-50 text-slate-700">{monthName(month)}</div></div>
          <div><label className="label">Voucher Date</label>
            <div className="input flex items-center bg-slate-50 text-slate-700">{dateStr(data?.entry_date ?? `${month}-01`)}</div></div>
          <div><label className="label">Narration</label>
            <div className="input flex items-center bg-slate-50 text-slate-700">Monthly service charges {monthName(month)}</div></div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Vehicle</th>
                <th className="px-2 py-2 text-left">Customer</th>
                <th className="px-2 py-2 text-left">Delivered</th>
                <th className="px-2 py-2 text-right">Amount</th>
                <th className="px-2 py-2 text-right">Paid</th>
                <th className="px-2 py-2 text-left">Notes</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const off = l.rule_amount > 0 && Math.abs(num(l.amount) - l.rule_amount) > 0.005;
                return (
                  <tr key={l.vehicle_id} className="border-t border-slate-100">
                    <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                    <td className="px-2 py-1">
                      <div className="font-medium text-slate-800">{l.vehicle}</div>
                      <div className="text-xs text-slate-400">{[l.car, l.plate].filter(Boolean).join(" · ")}</div>
                      {canEdit && (
                        <button type="button" onClick={() => transferOut(l.vehicle_id, l.vehicle)} disabled={busy}
                          className="mt-0.5 text-[11px] text-amber-600 hover:underline disabled:opacity-40">
                          Transfer out
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-1">{l.customer ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-2 py-1 tabular-nums text-slate-500">{l.delivered ? dateStr(l.delivered) : <span className="text-amber-600">not delivered</span>}</td>
                    <td className="px-2 py-1">
                      <input className={`input w-32 text-right tabular-nums ${off ? "border-amber-400 bg-amber-50" : ""}`}
                        inputMode="decimal" value={l.amount} disabled={!canEdit}
                        title={off ? `The rule says ${money(l.rule_amount, "SAR")}` : undefined}
                        onChange={(e) => setLine(i, { amount: e.target.value })} />
                      {off && <div className="text-[11px] text-amber-700">rule: {money(l.rule_amount, "SAR")}</div>}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-500">{l.paid ? money(l.paid, "SAR") : ""}</td>
                    <td className="px-2 py-1">
                      <input className="input w-64" value={l.notes} disabled={!canEdit}
                        onChange={(e) => setLine(i, { notes: e.target.value })} />
                    </td>
                    <td className="px-1 text-center">
                      {canEdit && <button onClick={() => removeLine(i)} className="text-slate-300 hover:text-red-500" title="Take off the voucher">×</button>}
                    </td>
                  </tr>
                );
              })}
              {lines.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-400">
                  No charges for {monthName(month)}. Generate from the rule, or add a car below.
                </td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td className="px-2 py-2 text-slate-500" colSpan={4}>Total</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(total, "SAR")}</td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-500">{paid ? money(paid, "SAR") : ""}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>

        {canEdit && candidates.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[20rem]">
              <label className="label">Add a car</label>
              <SearchSelect value={addId} onChange={setAddId} placeholder="— choose a vehicle on a contract —"
                options={candidates.map((c) => ({
                  value: c.vehicle_id,
                  label: `${c.vehicle}${c.car ? ` · ${c.car}` : ""}${c.customer ? ` — ${c.customer}` : ""}${c.delivered ? "" : " (not delivered)"}`,
                }))} />
            </div>
            <button onClick={addLine} disabled={!addId} className="btn-outline text-sm disabled:opacity-40">+ Line</button>
            <button onClick={() => { const c = candidates.find((x) => x.vehicle_id === addId); if (c) transferOut(c.vehicle_id, c.vehicle); }}
              disabled={!addId || busy} className="btn-outline text-sm text-amber-600 disabled:opacity-40">
              Transfer out
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={busy || !canEdit || (!dirty && posted)} className="btn disabled:opacity-40">
            {busy ? "Saving…" : posted ? "Save & re-post" : "Save & post"}
          </button>
          <span className="text-xs text-slate-400">
            Saving posts one voucher for the month: a debit to each customer and one credit to Monthly Service Charges.
            Payments come in through the Receipt voucher.
          </span>
        </div>
      </div>
    </div>
  );
}
