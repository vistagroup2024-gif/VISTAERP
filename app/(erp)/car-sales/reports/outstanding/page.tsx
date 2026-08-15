import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { sar } from "../../lib";

export const dynamic = "force-dynamic";

export default async function OutstandingReport() {
  await guardStaffPage("carsales.reports");
  const supabase = createClient();
  const { data } = await supabase.from("car_contracts")
    .select("id, contract_no, sale_price, advance, status, customer:customer_id(name), vehicle:vehicle_id(make, model, plate_no), car_installments(amount, paid_amount, due_date)")
    .neq("status", "cancelled").order("created_at", { ascending: false });
  const today = new Date().toISOString().slice(0, 10);
  const rows = (data ?? []).map((c: any) => {
    const insts = c.car_installments ?? [];
    const paid = insts.reduce((a: number, i: any) => a + Number(i.paid_amount || 0), 0);
    const due = insts.filter((i: any) => i.due_date <= today).reduce((a: number, i: any) => a + Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0)), 0);
    const overdue = insts.filter((i: any) => i.due_date < today).reduce((a: number, i: any) => a + Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0)), 0);
    return {
      id: c.id, contract_no: c.contract_no, customer: c.customer?.name ?? "—",
      vehicle: [c.vehicle?.make, c.vehicle?.model, c.vehicle?.plate_no].filter(Boolean).join(" "),
      total: Number(c.sale_price || 0), advance: Number(c.advance || 0), paid,
      outstanding: Number(c.sale_price || 0) - Number(c.advance || 0) - paid, due, overdue,
    };
  }).filter((r) => r.outstanding > 0.005);
  const t = rows.reduce((a, r) => ({ total: a.total + r.total, paid: a.paid + r.paid, outstanding: a.outstanding + r.outstanding, due: a.due + r.due, overdue: a.overdue + r.overdue }), { total: 0, paid: 0, outstanding: 0, due: 0, overdue: 0 });

  return (
    <div>
      <PageHeader title="Outstanding Details"><PrintButton /></PageHeader>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[820px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Contract</th><th className="th">Customer</th><th className="th">Vehicle</th>
            <th className="th text-right">Contract</th><th className="th text-right">Paid</th>
            <th className="th text-right">Outstanding</th><th className="th text-right">Due</th><th className="th text-right">Overdue</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td"><Link href={`/car-sales/contracts/${r.id}`} className="text-brand hover:underline">{r.contract_no}</Link></td>
                <td className="td">{r.customer}</td><td className="td">{r.vehicle}</td>
                <td className="td text-right tabular-nums">{sar(r.total)}</td>
                <td className="td text-right tabular-nums">{sar(r.paid)}</td>
                <td className="td text-right tabular-nums font-medium">{sar(r.outstanding)}</td>
                <td className="td text-right tabular-nums">{sar(r.due)}</td>
                <td className="td text-right tabular-nums">{r.overdue > 0 ? <span className="text-red-600">{sar(r.overdue)}</span> : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No outstanding balances.</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
            <td className="td" colSpan={3}>Total ({rows.length})</td>
            <td className="td text-right tabular-nums">{sar(t.total)}</td>
            <td className="td text-right tabular-nums">{sar(t.paid)}</td>
            <td className="td text-right tabular-nums">{sar(t.outstanding)}</td>
            <td className="td text-right tabular-nums">{sar(t.due)}</td>
            <td className="td text-right tabular-nums">{sar(t.overdue)}</td>
          </tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
