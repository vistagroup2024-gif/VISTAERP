import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { sar } from "../../lib";

export const dynamic = "force-dynamic";

// Reads car_installment_aging() (migration 430) — the same three due-date
// sources (installments, the invoice advance, monthly service charges)
// dashboard_metrics()'s car_due_items and car_customer_balances() already
// use, bucketed per contract instead of per customer so this report keeps
// its five ageing columns. Summing car_installments alone (the old
// approach) ignored the advance and service-charge legs and could disagree
// with the dashboard's Car Customer Balances card and the other two
// car-sales aging reports for any customer carrying either.
export default async function AgingReport() {
  await guardStaffPage("carsales.reports");
  const supabase = createClient();
  const { data } = await supabase.rpc("car_installment_aging");
  const rows = ((data ?? []) as any[]).map((r) => ({
    id: r.id, contract_no: r.contract_no, customer: r.customer ?? "—",
    current: Number(r.current || 0), d30: Number(r.d30 || 0), d60: Number(r.d60 || 0),
    d90: Number(r.d90 || 0), d90p: Number(r.d90p || 0), total: Number(r.total || 0),
  }));
  const t = rows.reduce((a, r) => ({ current: a.current + r.current, d30: a.d30 + r.d30, d60: a.d60 + r.d60, d90: a.d90 + r.d90, d90p: a.d90p + r.d90p, total: a.total + r.total }), { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 });

  return (
    <div>
      <PageHeader title="Installment Aging"><PrintButton /></PageHeader>
      <div className="card overflow-x-auto p-0">
        <table className="report-grid w-full min-w-[820px]">
          <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800"><tr>
            <th className="px-4 py-2.5 text-left"><span className="col-resize">Contract</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Customer</span></th>
            <th className="px-4 py-2.5 text-right"><span className="col-resize">Current</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">1-30</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">31-60</span></th>
            <th className="px-4 py-2.5 text-right"><span className="col-resize">61-90</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">90+</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Total</span></th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-100/80" : ""}`}>
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
          {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-400 bg-slate-200 font-bold">
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
