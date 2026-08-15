import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { sar } from "../../lib";

export const dynamic = "force-dynamic";
const days = (d: string) => Math.floor((Date.now() - new Date(d + "T00:00:00Z").getTime()) / 86400000);

export default async function AgingReport() {
  await guardStaffPage("carsales.reports");
  const supabase = createClient();
  const { data } = await supabase.from("car_contracts")
    .select("id, contract_no, status, customer:customer_id(name), car_installments(amount, paid_amount, due_date)")
    .neq("status", "cancelled");
  const today = new Date().toISOString().slice(0, 10);
  const rows = (data ?? []).map((c: any) => {
    const b = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 };
    for (const i of c.car_installments ?? []) {
      const rem = Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0));
      if (rem <= 0) continue;
      b.total += rem;
      if (i.due_date >= today) { b.current += rem; continue; }
      const dd = days(i.due_date);
      if (dd <= 30) b.d30 += rem; else if (dd <= 60) b.d60 += rem; else if (dd <= 90) b.d90 += rem; else b.d90p += rem;
    }
    return { id: c.id, contract_no: c.contract_no, customer: c.customer?.name ?? "—", ...b };
  }).filter((r) => r.total > 0.005);
  const t = rows.reduce((a, r) => ({ current: a.current + r.current, d30: a.d30 + r.d30, d60: a.d60 + r.d60, d90: a.d90 + r.d90, d90p: a.d90p + r.d90p, total: a.total + r.total }), { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 });

  return (
    <div>
      <PageHeader title="Installment Aging"><PrintButton /></PageHeader>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[820px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Contract</th><th className="th">Customer</th>
            <th className="th text-right">Current</th><th className="th text-right">1-30</th><th className="th text-right">31-60</th>
            <th className="th text-right">61-90</th><th className="th text-right">90+</th><th className="th text-right">Total</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td"><Link href={`/car-sales/contracts/${r.id}`} className="text-brand hover:underline">{r.contract_no}</Link></td>
                <td className="td">{r.customer}</td>
                <td className="td text-right tabular-nums">{sar(r.current)}</td>
                <td className="td text-right tabular-nums">{sar(r.d30)}</td>
                <td className="td text-right tabular-nums">{sar(r.d60)}</td>
                <td className="td text-right tabular-nums">{sar(r.d90)}</td>
                <td className="td text-right tabular-nums text-red-600">{sar(r.d90p)}</td>
                <td className="td text-right tabular-nums font-medium">{sar(r.total)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>Nothing outstanding.</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
            <td className="td" colSpan={2}>Total</td>
            <td className="td text-right tabular-nums">{sar(t.current)}</td><td className="td text-right tabular-nums">{sar(t.d30)}</td>
            <td className="td text-right tabular-nums">{sar(t.d60)}</td><td className="td text-right tabular-nums">{sar(t.d90)}</td>
            <td className="td text-right tabular-nums">{sar(t.d90p)}</td><td className="td text-right tabular-nums">{sar(t.total)}</td>
          </tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
