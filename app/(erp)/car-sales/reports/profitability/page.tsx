import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { guardStaffPage, staffCan } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { sar, vehicleTitle } from "../../lib";

export const dynamic = "force-dynamic";

export default async function ProfitabilityReport() {
  const access = await guardStaffPage("carsales.reports");
  if (!staffCan(access, "carsales.cost")) redirect("/car-sales/reports");
  const supabase = createClient();
  const { data } = await supabase.from("car_contracts")
    .select("id, contract_no, purchase_cost, sale_price, net_payable, advance, status, vehicle:vehicle_id(make, model, model_year, plate_no), car_installments(paid_amount, amount), car_commissions(amount)")
    .neq("status", "cancelled").order("created_at", { ascending: false });

  const rows = (data ?? []).map((c: any) => {
    const insts = c.car_installments ?? [];
    const collected = Number(c.advance || 0) + insts.reduce((a: number, i: any) => a + Number(i.paid_amount || 0), 0);
    const commission = (c.car_commissions ?? []).reduce((a: number, r: any) => a + Number(r.amount || 0), 0);
    const gross = Number(c.net_payable || 0) - Number(c.purchase_cost || 0);
    return {
      id: c.id, contract_no: c.contract_no, vehicle: vehicleTitle(c.vehicle ?? {}),
      cost: Number(c.purchase_cost || 0), sale: Number(c.net_payable || 0), gross, commission,
      net: gross - commission, collected, outstanding: Number(c.net_payable || 0) - collected,
    };
  });
  const t = rows.reduce((a, r) => ({ cost: a.cost + r.cost, sale: a.sale + r.sale, gross: a.gross + r.gross, commission: a.commission + r.commission, net: a.net + r.net, collected: a.collected + r.collected, outstanding: a.outstanding + r.outstanding }), { cost: 0, sale: 0, gross: 0, commission: 0, net: 0, collected: 0, outstanding: 0 });

  return (
    <div>
      <PageHeader title="Vehicle Profitability"><PrintButton /></PageHeader>
      <div className="card overflow-x-auto p-0">
        <table className="report-grid w-full min-w-[980px]">
          <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800"><tr>
            <th className="px-4 py-2.5 text-left"><span className="col-resize">Contract</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Vehicle</span></th>
            <th className="px-4 py-2.5 text-right"><span className="col-resize">Cost</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Sale</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Gross</span></th>
            <th className="px-4 py-2.5 text-right"><span className="col-resize">Commission</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Net</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Collected</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Outstanding</span></th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-100/80" : ""}`}>
                <td className="td"><Link href={`/car-sales/contracts/${r.id}`} className="text-brand hover:underline">{r.contract_no}</Link></td>
                <td className="td">{r.vehicle}</td>
                <td className="td text-right tabular-nums">{sar(r.cost)}</td>
                <td className="td text-right tabular-nums">{sar(r.sale)}</td>
                <td className="td text-right tabular-nums">{sar(r.gross)}</td>
                <td className="td text-right tabular-nums">{sar(r.commission)}</td>
                <td className={`td text-right tabular-nums font-medium ${r.net < 0 ? "text-red-600" : "text-emerald-700"}`}>{sar(r.net)}</td>
                <td className="td text-right tabular-nums">{sar(r.collected)}</td>
                <td className="td text-right tabular-nums">{sar(r.outstanding)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No contracts.</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-400 bg-slate-200 font-bold">
            <td className="td" colSpan={2}>Total ({rows.length})</td>
            <td className="td text-right tabular-nums">{sar(t.cost)}</td><td className="td text-right tabular-nums">{sar(t.sale)}</td>
            <td className="td text-right tabular-nums">{sar(t.gross)}</td><td className="td text-right tabular-nums">{sar(t.commission)}</td>
            <td className={`td text-right tabular-nums ${t.net < 0 ? "text-red-600" : ""}`}>{sar(t.net)}</td><td className="td text-right tabular-nums">{sar(t.collected)}</td>
            <td className="td text-right tabular-nums">{sar(t.outstanding)}</td>
          </tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
