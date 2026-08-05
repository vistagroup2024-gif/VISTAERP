import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { getStaffAccess, staffCan } from "@/lib/staffSession";
import { dateStr } from "@/lib/format";
import LedgerRange from "./LedgerRange";

export const dynamic = "force-dynamic";

function monthStart() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }
const money = (n: any) => (n == null || n === "" ? "—" : `${Number(n).toFixed(2)} SAR`);

export default async function TransportLedgerPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const access = await getStaffAccess();
  if (!staffCan(access, "transport.trip_ledger")) {
    return <div className="card m-6 text-slate-500">You don’t have permission to view the Transport Trip Ledger.</div>;
  }
  const sb = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const from = searchParams.from || monthStart();
  const to = searchParams.to || today;

  const { data, error } = await sb.rpc("transport_trip_ledger", { p_from: from, p_to: to });
  const rows: any[] = (data as any[]) ?? [];
  const totFare = rows.reduce((a, r) => a + Number(r.trip_fare || 0), 0);
  const totSupp = rows.reduce((a, r) => a + Number(r.supplier_amount || 0), 0);

  return (
    <div className="max-w-[1400px]">
      <PageHeader title="Transport Trip Ledger"><PrintButton /></PageHeader>
      <LedgerRange from={from} to={to} rows={rows} />
      {error && <div className="card text-red-600">{error.message}</div>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr>
            <th className="th">Trip Date</th><th className="th">Supplier</th><th className="th">Customer</th>
            <th className="th">Haji Name</th><th className="th">Booking Car</th><th className="th">Driver</th>
            <th className="th">Route</th><th className="th text-right">Trip Fare</th><th className="th text-right">Supplier Amt</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="td whitespace-nowrap">{dateStr(r.trip_date)}{r.trip_time ? ` · ${r.trip_time}` : ""}</td>
                <td className="td">{r.supplier_name ?? <span className="text-slate-300">in-house</span>}</td>
                <td className="td">{r.customer_name ?? "—"}</td>
                <td className="td">{r.haji_name ?? "—"}</td>
                <td className="td">{r.booking_car ?? "—"}</td>
                <td className="td">{r.driver_name ?? <span className="text-slate-300">—</span>}</td>
                <td className="td">{r.route ?? "—"}</td>
                <td className="td text-right">{money(r.trip_fare)}</td>
                <td className="td text-right">{money(r.supplier_amount)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No trips in this range.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="td" colSpan={7}>Total ({rows.length} trips)</td>
              <td className="td text-right">{money(totFare)}</td>
              <td className="td text-right">{money(totSupp)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
