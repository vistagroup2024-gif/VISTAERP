import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { getStaffAccess, staffCan } from "@/lib/staffSession";
import { dateStr } from "@/lib/format";
import LedgerRange from "./LedgerRange";
import InvoiceCheck from "./InvoiceCheck";

export const dynamic = "force-dynamic";

function monthStart() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }
const money = (n: any) => (n == null || n === "" ? "—" : `${Number(n).toFixed(2)} SAR`);

export default async function TransportLedgerPage({ searchParams }: { searchParams: { from?: string; to?: string; pending?: string } }) {
  const access = await getStaffAccess();
  if (!staffCan(access, "transport.trip_ledger")) {
    return <div className="card m-6 text-slate-500">You don’t have permission to view the Transport Trip Ledger.</div>;
  }
  const sb = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const from = searchParams.from || monthStart();
  const to = searchParams.to || today;
  const pendingOnly = searchParams.pending === "1";

  const { data, error } = await sb.rpc("transport_trip_ledger", { p_from: from, p_to: to });
  const all: any[] = (data as any[]) ?? [];
  const pendingCount = all.filter((r) => !r.invoice_created).length;
  const rows = pendingOnly ? all.filter((r) => !r.invoice_created) : all;
  const totFare = rows.reduce((a, r) => a + Number(r.trip_fare || 0), 0);
  const totSupp = rows.reduce((a, r) => a + Number(r.supplier_amount || 0), 0);
  const totCash = rows.reduce((a, r) => a + Number(r.cash_received || 0), 0);

  const rangeQ = `from=${from}&to=${to}`;

  return (
    <div className="max-w-[1400px]">
      <PageHeader title="Transport Trip Ledger"><PrintButton /></PageHeader>
      <LedgerRange from={from} to={to} rows={rows} />
      {error && <div className="card text-red-600">{error.message}</div>}

      <div className="no-print mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span className={`rounded-full px-3 py-1 font-medium ${pendingCount ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
          {pendingCount ? `${pendingCount} invoice${pendingCount === 1 ? "" : "s"} pending` : "All invoiced ✓"}
        </span>
        {pendingOnly
          ? <Link href={`/transport/reports/ledger?${rangeQ}`} className="text-brand hover:underline">Show all</Link>
          : <Link href={`/transport/reports/ledger?${rangeQ}&pending=1`} className="text-brand hover:underline">Show pending invoices only</Link>}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr>
            <th className="th">Trip Date</th><th className="th">Supplier</th><th className="th">Customer</th>
            <th className="th">Haji Name</th><th className="th">Booking Car</th><th className="th">Driver</th>
            <th className="th">Route</th><th className="th text-right">Trip Fare</th><th className="th text-right">Supplier Amt</th><th className="th text-right">Cash Rcvd</th>
            <th className="th">Invoice</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.trip_id} className={`border-t border-slate-100 ${r.invoice_created ? "" : "bg-amber-50/40"}`}>
                <td className="td whitespace-nowrap">{dateStr(r.trip_date)}</td>
                <td className="td">{r.supplier_name ?? <span className="text-slate-300">in-house</span>}</td>
                <td className="td">{r.customer_name ?? "—"}</td>
                <td className="td">{r.haji_name ?? "—"}</td>
                <td className="td">{r.booking_car ?? "—"}</td>
                <td className="td">{r.driver_name ?? <span className="text-slate-300">—</span>}</td>
                <td className="td">{r.route ?? "—"}</td>
                <td className="td text-right">{money(r.trip_fare)}</td>
                <td className="td text-right">{money(r.supplier_amount)}</td>
                <td className="td text-right">{r.cash_received == null ? "—" : money(r.cash_received)}</td>
                <td className="td"><InvoiceCheck tripId={r.trip_id} done={!!r.invoice_created} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={11}>No trips in this range.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="td" colSpan={7}>Total ({rows.length} trips)</td>
              <td className="td text-right">{money(totFare)}</td>
              <td className="td text-right">{money(totSupp)}</td>
              <td className="td text-right">{money(totCash)}</td>
              <td className="td"></td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
