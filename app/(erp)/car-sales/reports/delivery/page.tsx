import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import { COMPANY_ID, dateStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { sar, VEHICLE_STATUS_LABEL, VEHICLE_STATUS_TONE, vehicleTitle } from "../../lib";

export const dynamic = "force-dynamic";

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

// Car Delivery Report — the dashboard's Delivery Status card, one row per
// vehicle. report_car_delivery() (migration 414, extended in 426 with an
// optional date range and contract_id) reads the exact same
// car_vehicles.status dashboard_metrics() counts, so the KPIs here always
// foot to the card when no date filter is applied — same as the card.
export default async function CarDeliveryReport({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  await guardStaffPage("carsales.reports");
  const supabase = createClient();
  const from = searchParams.from || "";
  const to = searchParams.to || "";
  const { data } = await supabase.rpc("report_car_delivery", { p_company: COMPANY_ID, p_from: from || null, p_to: to || null });
  const rows = ((data ?? []) as any[]);
  const sold = rows.filter((r) => r.status === "sold" || r.status === "delivered").length;
  const delivered = rows.filter((r) => r.delivered).length;
  const pending = sold - delivered;
  const pct = sold > 0 ? (delivered / sold) * 100 : 0;

  return (
    <div>
      <PageHeader title="Car Delivery Report" subtitle="Sold vehicles and their delivery status, with the invoice that sold them."><PrintButton /></PageHeader>
      <form className="card mb-4 flex flex-wrap items-end gap-3 print:hidden" method="get">
        <div><label className="label">Invoice Date From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">Invoice Date To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
        {(from || to) && <a href="/car-sales/reports/delivery" className="text-sm text-slate-400 hover:underline">Clear</a>}
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Sales Quantity" value={String(sold)} />
        <Kpi label="Delivered" value={String(delivered)} tone="text-green-700" />
        <Kpi label="Pending" value={String(pending)} tone={pending > 0 ? "text-amber-700" : "text-green-700"} />
        <Kpi label="Delivery %" value={`${pct.toFixed(1)}%`} />
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px]">
          <thead className="bg-slate-700 text-[11px] font-semibold uppercase tracking-wide text-slate-200"><tr>
            <th className="px-4 py-2.5 text-left">Vehicle</th><th className="px-4 py-2.5 text-left">Cost Centre</th><th className="px-4 py-2.5 text-left">Customer</th>
            <th className="px-4 py-2.5 text-left">Tag Area</th><th className="px-4 py-2.5 text-left">Invoice No</th><th className="px-4 py-2.5 text-left">Invoice Date</th>
            <th className="px-4 py-2.5 text-right">Invoice Amount</th><th className="px-4 py-2.5 text-left">Status</th>
          </tr></thead>
          <tbody>
            {rows.filter((r) => r.status === "sold" || r.status === "delivered").map((r) => (
              <tr key={r.vehicle_id} className="border-t border-slate-100">
                <td className="td">{vehicleTitle(r)}{r.plate_no ? <span className="ml-1 text-xs text-slate-400">{r.plate_no}</span> : null}</td>
                <td className="td">{r.cost_centre ?? "—"}</td>
                <td className="td">{r.customer ?? "—"}</td>
                <td className="td">{r.tag_area ?? "—"}</td>
                <td className="td">
                  {r.contract_id ? <Link href={`/car-sales/contracts/${r.contract_id}`} className="text-brand hover:underline">{r.invoice_no ?? "—"}</Link> : (r.invoice_no ?? "—")}
                </td>
                <td className="td">{r.invoice_date ? dateStr(r.invoice_date) : "—"}</td>
                <td className="td text-right tabular-nums">{sar(r.invoice_amount)}</td>
                <td className="td"><span className={`badge ${VEHICLE_STATUS_TONE[r.status] ?? ""}`}>{VEHICLE_STATUS_LABEL[r.status] ?? r.status}</span></td>
              </tr>
            ))}
            {sold === 0 && <tr><td className="td text-slate-400" colSpan={8}>No cars sold in this window.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
