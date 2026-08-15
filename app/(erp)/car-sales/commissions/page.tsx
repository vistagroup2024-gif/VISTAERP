import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import { dateStr } from "@/lib/format";
import { sar } from "../lib";

export const dynamic = "force-dynamic";

export default async function CommissionsPage() {
  await guardStaffPage(["carsales.ownership", "carsales.sales"]);
  const supabase = createClient();
  const { data } = await supabase
    .from("car_commissions")
    .select("id, reference_name, comm_type, comm_value, amount, paid, paid_date, contract:contract_id(id, contract_no, customer:customer_id(name))")
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows = (data ?? []) as any[];
  const total = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
  const unpaid = rows.filter((r) => !r.paid).reduce((a, r) => a + Number(r.amount || 0), 0);

  return (
    <div>
      <PageHeader title="Commissions" />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="card px-4 py-3"><div className="text-xs uppercase tracking-wide text-slate-500">Total</div><div className="text-2xl font-bold tabular-nums">{sar(total)}</div></div>
        <div className="card px-4 py-3"><div className="text-xs uppercase tracking-wide text-slate-500">Unpaid</div><div className="text-2xl font-bold tabular-nums text-amber-700">{sar(unpaid)}</div></div>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Contract</th><th className="th">Customer</th><th className="th">Reference</th>
            <th className="th">Type</th><th className="th text-right">Amount</th><th className="th">Paid</th><th className="th">Paid Date</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td"><Link href={`/car-sales/contracts/${r.contract?.id}`} className="text-brand hover:underline">{r.contract?.contract_no}</Link></td>
                <td className="td">{r.contract?.customer?.name ?? "—"}</td>
                <td className="td">{r.reference_name ?? "—"}</td>
                <td className="td capitalize">{r.comm_type}{r.comm_type === "percentage" ? ` (${r.comm_value}%)` : ""}</td>
                <td className="td text-right tabular-nums">{sar(r.amount)}</td>
                <td className="td"><span className={`badge ${r.paid ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{r.paid ? "Paid" : "Unpaid"}</span></td>
                <td className="td">{dateStr(r.paid_date)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No commissions recorded.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
