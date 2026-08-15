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
    .select("id, contract_no, purchase_cost, sale_price, advance, status, vehicle:vehicle_id(make, model, model_year, plate_no), car_installments(paid_amount, amount), car_commissions(amount)")
    .neq("status", "cancelled").order("created_at", { ascending: false });

  const rows = (data ?? []).map((c: any) => {
    const insts = c.car_installments ?? [];
    const collected = Number(c.advance || 0) + insts.reduce((a: number, i: any) => a + Number(i.paid_amount || 0), 0);
    const commission = (c.car_commissions ?? []).reduce((a: number, r: any) => a + Number(r.amount || 0), 0);
    const gross = Number(c.sale_price || 0) - Number(c.purchase_cost || 0);
    return {
      id: c.id, contract_no: c.contract_no, vehicle: vehicleTitle(c.vehicle ?? {}),
      cost: Number(c.purchase_cost || 0), sale: Number(c.sale_price || 0), gross, commission,
      net: gross - commission, collected, outstanding: Number(c.sale_price || 0) - collected,
    };
  });
  const t = rows.reduce((a, r) => ({ cost: a.cost + r.cost, sale: a.sale + r.sale, gross: a.gross + r.gross, commission: a.commission + r.commission, net: a.net + r.net, collected: a.collected + r.collected, outstanding: a.outstanding + r.outstanding }), { cost: 0, sale: 0, gross: 0, commission: 0, net: 0, collected: 0, outstanding: 0 });

  return (
    <div>
      <PageHeader title="Vehicle Profitability"><PrintButton /></PageHeader>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[980px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Contract</th><th className="th">Vehicle</th>
            <th className="th text-right">Cost</th><th className="th text-right">Sale</th><th className="th text-right">Gross</th>
            <th className="th text-right">Commission</th><th className="th text-right">Net</th><th className="th text-right">Collected</th><th className="th text-right">Outstanding</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td"><Link href={`/car-sales/contracts/${r.id}`} className="text-brand hover:underline">{r.contract_no}</Link></td>
                <td className="td">{r.vehicle}</td>
                <td className="td text-right tabular-nums">{sar(r.cost)}</td>
                <td className="td text-right tabular-nums">{sar(r.sale)}</td>
                <td className="td text-right tabular-nums">{sar(r.gross)}</td>
                <td className="td text-right tabular-nums">{sar(r.commission)}</td>
                <td className="td text-right tabular-nums font-medium text-emerald-700">{sar(r.net)}</td>
                <td className="td text-right tabular-nums">{sar(r.collected)}</td>
                <td className="td text-right tabular-nums">{sar(r.outstanding)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No contracts.</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
            <td className="td" colSpan={2}>Total ({rows.length})</td>
            <td className="td text-right tabular-nums">{sar(t.cost)}</td><td className="td text-right tabular-nums">{sar(t.sale)}</td>
            <td className="td text-right tabular-nums">{sar(t.gross)}</td><td className="td text-right tabular-nums">{sar(t.commission)}</td>
            <td className="td text-right tabular-nums">{sar(t.net)}</td><td className="td text-right tabular-nums">{sar(t.collected)}</td>
            <td className="td text-right tabular-nums">{sar(t.outstanding)}</td>
          </tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
