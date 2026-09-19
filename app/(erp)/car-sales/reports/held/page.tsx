import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { dateStr } from "@/lib/format";
import { sar, vehicleTitle } from "../../lib";
import { todaySA } from "@/lib/saudiTime";

export const dynamic = "force-dynamic";

export default async function HeldReport() {
  await guardStaffPage("carsales.reports");
  const supabase = createClient();
  const { data } = await supabase.from("car_holdings")
    .select("id, held_date, reason, agreement_notes, vehicle:vehicle_id(id, make, model, model_year, plate_no, vehicle_no), contract:contract_id(id, contract_no, sale_price, net_payable, advance, customer:customer_id(name), car_installments(amount, paid_amount, due_date))")
    .is("released_at", null).order("held_date", { ascending: false });
  const today = todaySA();

  const rows = (data ?? []).map((h: any) => {
    const c = h.contract; const insts = c?.car_installments ?? [];
    const paid = insts.reduce((a: number, i: any) => a + Number(i.paid_amount || 0), 0);
    const outstanding = c ? Number(c.net_payable || 0) - Number(c.advance || 0) - paid : 0;
    const overdue = insts.filter((i: any) => i.due_date < today).reduce((a: number, i: any) => a + Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0)), 0);
    const nextDue = insts.filter((i: any) => Number(i.paid_amount || 0) < Number(i.amount || 0)).map((i: any) => i.due_date).sort()[0] ?? null;
    return { id: h.id, held_date: h.held_date, reason: h.reason, vehicle: h.vehicle, customer: c?.customer?.name ?? "—", contract: c, outstanding, overdue, nextDue };
  });

  return (
    <div>
      <PageHeader title="Vehicles Held by Vista"><PrintButton /></PageHeader>
      <div className="card overflow-x-auto p-0">
        <table className="report-grid w-full min-w-[900px]">
          <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800"><tr>
            <th className="px-4 py-2.5 text-left"><span className="col-resize">Vehicle</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Customer</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Contract</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Held Date</span></th>
            <th className="px-4 py-2.5 text-left"><span className="col-resize">Reason</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Outstanding</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Overdue</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Next Due</span></th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/70" : ""}`}>
                <td className="td">{r.vehicle ? <Link href={`/car-sales/vehicles/${r.vehicle.id}`} className="text-brand hover:underline">{vehicleTitle(r.vehicle)}</Link> : "—"}<div className="text-xs text-slate-400">{r.vehicle?.plate_no ?? ""}</div></td>
                <td className="td">{r.customer}</td>
                <td className="td">{r.contract ? <Link href={`/car-sales/contracts/${r.contract.id}`} className="text-brand hover:underline">{r.contract.contract_no}</Link> : "—"}</td>
                <td className="td">{dateStr(r.held_date)}</td>
                <td className="td text-sm">{r.reason ?? "—"}</td>
                <td className={`td text-right tabular-nums ${r.outstanding < 0 ? "text-red-600" : ""}`}>{sar(r.outstanding)}</td>
                <td className="td text-right tabular-nums text-red-600">{sar(r.overdue)}</td>
                <td className="td">{dateStr(r.nextDue)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No vehicles currently held.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
