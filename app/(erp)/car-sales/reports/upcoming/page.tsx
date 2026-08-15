import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { dateStr } from "@/lib/format";
import { sar } from "../../lib";

export const dynamic = "force-dynamic";

export default async function UpcomingReport({ searchParams }: { searchParams: { days?: string } }) {
  await guardStaffPage("carsales.reports");
  const supabase = createClient();
  const win = Number(searchParams.days ?? "30");
  const today = new Date();
  const until = new Date(today.getTime() + win * 86400000).toISOString().slice(0, 10);
  const todayS = today.toISOString().slice(0, 10);

  const { data } = await supabase.from("car_contracts")
    .select("id, contract_no, status, customer:customer_id(name, phone), car_installments(inst_no, amount, paid_amount, due_date)")
    .eq("status", "active");
  const rows: any[] = [];
  for (const c of (data ?? []) as any[]) {
    for (const i of c.car_installments ?? []) {
      const rem = Number(i.amount || 0) - Number(i.paid_amount || 0);
      if (rem > 0.005 && i.due_date >= todayS && i.due_date <= until) {
        rows.push({ id: c.id, contract_no: c.contract_no, customer: c.customer?.name ?? "—", phone: c.customer?.phone ?? "—", inst_no: i.inst_no, due: i.due_date, amount: rem });
      }
    }
  }
  rows.sort((a, b) => (a.due < b.due ? -1 : 1));
  const total = rows.reduce((a, r) => a + r.amount, 0);

  return (
    <div>
      <PageHeader title="Upcoming Collection"><PrintButton /></PageHeader>
      <div className="no-print mb-3 flex gap-2 text-sm">
        {[7, 30, 60].map((d) => <Link key={d} href={`/car-sales/reports/upcoming?days=${d}`} className={`rounded-full px-3 py-1 ${win === d ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>Next {d} days</Link>)}
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Due Date</th><th className="th">Contract</th><th className="th">Customer</th><th className="th">Contact</th>
            <th className="th text-right">Inst #</th><th className="th text-right">Amount</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="td">{dateStr(r.due)}</td>
                <td className="td"><Link href={`/car-sales/contracts/${r.id}`} className="text-brand hover:underline">{r.contract_no}</Link></td>
                <td className="td">{r.customer}</td><td className="td">{r.phone}</td>
                <td className="td text-right">{r.inst_no}</td>
                <td className="td text-right tabular-nums">{sar(r.amount)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>Nothing due in this window.</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold"><td className="td" colSpan={5}>Total ({rows.length})</td><td className="td text-right tabular-nums">{sar(total)}</td></tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
