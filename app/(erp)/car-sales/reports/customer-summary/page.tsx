import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { sar } from "../../lib";

export const dynamic = "force-dynamic";

// Reads car_customer_balances() — the same RPC the Outstanding Details report
// and the dashboard's Car Customer Balances card read — instead of re-deriving
// due/overdue from car_installments alone, which ignores the advance-due leg
// and the monthly service charge and so disagreed with the card for any
// customer carrying either. See migration 401.
export default async function CustomerSummaryReport() {
  await guardStaffPage("carsales.reports");
  const supabase = createClient();
  const { data } = await supabase.rpc("car_customer_balances");
  const rows = ((data ?? []) as any[]).map((r) => ({
    id: r.customer_id, name: r.name ?? "—", phone: r.phone ?? "—",
    cars: Number(r.cars || 0), value: Number(r.value || 0), advance: Number(r.advance || 0),
    due: Number(r.due || 0), overdue: Number(r.overdue || 0), balance: Number(r.balance || 0), collected: Number(r.collected || 0),
  })).filter((r) => Math.abs(r.balance) > 0.005 || r.due + r.overdue > 0.005)
    .sort((a, b) => b.balance - a.balance);

  return (
    <div>
      <PageHeader title="Customer Summary" subtitle="Same figures as the dashboard's Car Customer Balances card and the Outstanding Details report."><PrintButton /></PageHeader>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Customer</th><th className="th">Mobile</th><th className="th text-right">Cars</th>
            <th className="th text-right">Contract Value</th><th className="th text-right">Collected</th>
            <th className="th text-right">Due</th><th className="th text-right">Overdue</th><th className="th text-right">Ledger Balance</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td"><Link href={`/car-sales/customers/${r.id}`} className="text-brand hover:underline">{r.name}</Link></td>
                <td className="td">{r.phone}</td>
                <td className="td text-right">{r.cars}</td>
                <td className="td text-right tabular-nums">{sar(r.value)}</td>
                <td className="td text-right tabular-nums">{sar(r.collected)}</td>
                <td className="td text-right tabular-nums">{sar(r.due)}</td>
                <td className="td text-right tabular-nums text-red-600">{sar(r.overdue)}</td>
                <td className="td text-right tabular-nums font-medium">{sar(r.balance)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No customers with contracts.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
