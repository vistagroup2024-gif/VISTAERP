import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { sar } from "../../lib";

export const dynamic = "force-dynamic";

export default async function CustomerSummaryReport() {
  await guardStaffPage("carsales.reports");
  const supabase = createClient();
  const { data } = await supabase.from("car_contracts")
    .select("customer_id, sale_price, advance, status, customer:customer_id(name, phone, tax_number), car_installments(amount, paid_amount, due_date)")
    .neq("status", "cancelled");
  const today = new Date().toISOString().slice(0, 10);

  const byC = new Map<string, any>();
  for (const c of (data ?? []) as any[]) {
    const k = c.customer_id; if (!k) continue;
    const insts = c.car_installments ?? [];
    const paid = insts.reduce((a: number, i: any) => a + Number(i.paid_amount || 0), 0);
    const overdue = insts.filter((i: any) => i.due_date < today).reduce((a: number, i: any) => a + Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0)), 0);
    const due = insts.filter((i: any) => i.due_date <= today).reduce((a: number, i: any) => a + Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0)), 0);
    const cur = byC.get(k) ?? { id: k, name: c.customer?.name ?? "—", phone: c.customer?.phone ?? "—", iqama: c.customer?.tax_number ?? "—", cars: 0, value: 0, paid: 0, outstanding: 0, due: 0, overdue: 0 };
    cur.cars += 1; cur.value += Number(c.sale_price || 0); cur.paid += Number(c.advance || 0) + paid;
    cur.outstanding += Number(c.sale_price || 0) - Number(c.advance || 0) - paid; cur.due += due; cur.overdue += overdue;
    byC.set(k, cur);
  }
  const rows = Array.from(byC.values()).sort((a, b) => b.outstanding - a.outstanding);

  return (
    <div>
      <PageHeader title="Customer Summary"><PrintButton /></PageHeader>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Customer</th><th className="th">Iqama/ID</th><th className="th">Mobile</th><th className="th text-right">Cars</th>
            <th className="th text-right">Contract Value</th><th className="th text-right">Paid</th><th className="th text-right">Outstanding</th>
            <th className="th text-right">Due</th><th className="th text-right">Overdue</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td"><Link href={`/car-sales/customers/${r.id}`} className="text-brand hover:underline">{r.name}</Link></td>
                <td className="td">{r.iqama}</td><td className="td">{r.phone}</td>
                <td className="td text-right">{r.cars}</td>
                <td className="td text-right tabular-nums">{sar(r.value)}</td>
                <td className="td text-right tabular-nums">{sar(r.paid)}</td>
                <td className="td text-right tabular-nums font-medium">{sar(r.outstanding)}</td>
                <td className="td text-right tabular-nums">{sar(r.due)}</td>
                <td className="td text-right tabular-nums text-red-600">{sar(r.overdue)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No customers with contracts.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
