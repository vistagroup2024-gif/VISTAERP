"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr, money } from "@/lib/format";
import { todaySA } from "@/lib/saudiTime";
import SearchSelect from "@/components/ui/SearchSelect";

// Vehicle Transfer, as a voucher: pick the car, see what it still owes, fill
// in where it's going, and save. car_vehicle_transfer (migration 176) is the
// one door — it records the transfer and flips car_vehicles.ownership to
// 'transferred', the one flag car_gen_charges_company() checks before
// generating a future month, so Monthly Service Charges stop on their own
// from here.
//
// This screen SHOWS the outstanding balance so transferring is a decision
// made with it in view — it does not settle or write anything off. Anything
// still owed goes through an ordinary Receipt Voucher, before or after
// transfer, the same as any other collection.

type Candidate = { id: string; vehicle_no: string; car: string | null; plate_no: string | null; customer: string | null };
type Dues = {
  installment_total: number; installment_due: number; installment_overdue: number;
  service_charge_total: number; service_charge_due: number; service_charge_overdue: number;
  total: number; total_due: number; total_overdue: number;
};
type Detail = {
  vehicle_id: string; vehicle_no: string; car: string | null; plate_no: string | null; vin: string | null;
  ownership: string; contract_no: string | null; customer: string | null; dues: Dues;
  last_transfer: { transfer_date: string; destination: string | null; reference: string | null; notes: string | null } | null;
};

export default function VehicleTransferVoucher({ canEdit, initialVehicleId }: { canEdit: boolean; initialVehicleId?: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [vehicleId, setVehicleId] = useState(initialVehicleId ?? "");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [f, setF] = useState({ transfer_date: todaySA(), destination: "", reference: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const loadCandidates = useCallback(async () => {
    const { data, error } = await supabase.rpc("car_transfer_candidates");
    if (!error) setCandidates((data as Candidate[]) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) { setDetail(null); return; }
    setLoading(true); setErr(null);
    const { data, error } = await supabase.rpc("car_vehicle_transfer_load", { p_vehicle: id });
    setLoading(false);
    if (error) { setErr(error.message); setDetail(null); return; }
    setDetail(data as Detail);
    setF({ transfer_date: todaySA(), destination: "", reference: "", notes: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { setDone(null); loadDetail(vehicleId); }, [vehicleId, loadDetail]);

  const alreadyTransferred = detail?.ownership === "transferred";

  async function save() {
    if (!canEdit || !detail || alreadyTransferred) return;
    if (!confirm(
      `Transfer ${detail.vehicle_no} out of Vista's name?\n\n` +
      `This stops future Monthly Service Charges for this vehicle. ` +
      (detail.dues.total > 0
        ? `It still owes ${money(detail.dues.total, "SAR")} — this is not settled or written off by saving; collect it separately through a Receipt Voucher.`
        : `Nothing is outstanding on it.`)
    )) return;
    setBusy(true); setErr(null); setDone(null);
    const { error } = await supabase.rpc("car_vehicle_transfer", {
      p_vehicle: detail.vehicle_id,
      p: { transfer_date: f.transfer_date, destination: f.destination || null, reference: f.reference || null, notes: f.notes || null },
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setDone(`${detail.vehicle_no} transferred out — Monthly Service Charges stop from here`);
    await loadDetail(detail.vehicle_id);
    await loadCandidates();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Vehicle Transfer</h1>
        {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">{done}</span>}
      </div>

      <div className="card space-y-4">
        <div className="max-w-lg">
          <label className="label">Vehicle</label>
          <SearchSelect value={vehicleId} onChange={setVehicleId} placeholder="— search a Vista-owned vehicle —"
            options={candidates.map((c) => ({
              value: c.id,
              label: `${c.vehicle_no}${c.car ? ` · ${c.car}` : ""}${c.plate_no ? ` · ${c.plate_no}` : ""}${c.customer ? ` — ${c.customer}` : ""}`,
            }))} />
        </div>

        {err && <div className="rounded-md border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
        {loading && <p className="text-sm text-slate-400">Loading…</p>}

        {detail && !loading && (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div><label className="label">Vehicle</label>
                <div className="input flex items-center bg-slate-50 text-slate-700">{detail.vehicle_no}{detail.car ? ` · ${detail.car}` : ""}</div></div>
              <div><label className="label">Plate</label>
                <div className="input flex items-center bg-slate-50 text-slate-700">{detail.plate_no ?? "—"}</div></div>
              <div><label className="label">Contract</label>
                <div className="input flex items-center bg-slate-50 text-slate-700">{detail.contract_no ?? "—"}</div></div>
              <div><label className="label">Customer</label>
                <div className="input flex items-center bg-slate-50 text-slate-700">{detail.customer ?? "—"}</div></div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="card px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Instalments Outstanding</div>
                <div className="text-xl font-bold tabular-nums text-slate-800">{money(detail.dues.installment_total, "SAR")}</div>
              </div>
              <div className="card px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Service Charges Outstanding</div>
                <div className="text-xl font-bold tabular-nums text-slate-800">{money(detail.dues.service_charge_total, "SAR")}</div>
              </div>
              <div className="card px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Total Outstanding</div>
                <div className={`text-xl font-bold tabular-nums ${detail.dues.total > 0 ? "text-red-600" : "text-emerald-700"}`}>
                  {money(detail.dues.total, "SAR")}
                </div>
              </div>
            </div>
            {detail.dues.total > 0 && (
              <p className="text-xs text-amber-700">
                Still owes {money(detail.dues.total, "SAR")} ({money(detail.dues.total_overdue, "SAR")} of it overdue). Transferring does not
                settle or write this off — collect it through an ordinary Receipt Voucher, before or after transfer.
              </p>
            )}

            {alreadyTransferred ? (
              <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                Already transferred{detail.last_transfer?.transfer_date ? ` on ${dateStr(detail.last_transfer.transfer_date)}` : ""}
                {detail.last_transfer?.destination ? ` to ${detail.last_transfer.destination}` : ""}. Monthly Service Charges have stopped.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div><label className="label">Transfer Date</label>
                    <input type="date" className="input" value={f.transfer_date} disabled={!canEdit}
                      onChange={(e) => setF({ ...f, transfer_date: e.target.value })} /></div>
                  <div className="md:col-span-2"><label className="label">Destination / Company</label>
                    <input className="input" value={f.destination} disabled={!canEdit} placeholder="who the vehicle is going to"
                      onChange={(e) => setF({ ...f, destination: e.target.value })} /></div>
                  <div><label className="label">Reference</label>
                    <input className="input" value={f.reference} disabled={!canEdit}
                      onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
                  <div className="md:col-span-4"><label className="label">Notes</label>
                    <input className="input" value={f.notes} disabled={!canEdit}
                      onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={save} disabled={busy || !canEdit} className="btn disabled:opacity-40">
                    {busy ? "Saving…" : "Save & transfer"}
                  </button>
                  <span className="text-xs text-slate-400">
                    Saving stops future Monthly Service Charges for this vehicle. Charges already billed stay payable.
                  </span>
                </div>
              </>
            )}
          </>
        )}

        {!detail && !loading && vehicleId === "" && (
          <p className="text-sm text-slate-400">Search a vehicle above to see what it owes and transfer it out.</p>
        )}
      </div>
    </div>
  );
}
