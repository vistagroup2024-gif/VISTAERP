import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import Link from "next/link";
import ReportRange from "./ReportRange";
import { getStaffAccess, staffCan } from "@/lib/staffSession";
import { todaySA, monthStartSA } from "@/lib/saudiTime";
import { COMPANY_ID } from "@/lib/format";
import TrendChart from "@/components/reports/charts/TrendChart";
import DataTable from "@/components/reports/DataTable";

export const dynamic = "force-dynamic";

const monthStart = () => monthStartSA();

function Table({ title, cols, rows }: { title: string; cols: string[]; rows: any[][] }) {
  return (
    <div className="card overflow-x-auto p-0">
      <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">{title}</div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr>{cols.map((c) => <th key={c} className="th">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="td">{c}</td>)}</tr>)}
          {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={cols.length}>No data.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const access = await getStaffAccess();
  const canLedger = staffCan(access, "transport.trip_ledger");
  const today = todaySA();
  const from = searchParams.from || monthStart();
  const to = searchParams.to || today;

  const [{ data, error }, { data: expenses }, { data: ratings }, { data: extraData }] = await Promise.all([
    sb.rpc("transport_reports", { p_from: from, p_to: to }),
    sb.from("transport_expenses").select("category, amount").gte("spent_on", from).lte("spent_on", to),
    sb.from("transport_ratings").select("rating, driver_id").gte("created_at", from).lte("created_at", to + "T23:59:59"),
    sb.rpc("report_transport_bookings_extra", { p_company: COMPANY_ID, p_from: from, p_to: to }),
  ]);
  const r: any = data ?? {};
  const s = r.summary ?? {};
  const extra: any = extraData ?? { by_country: [], monthly: [], trips: [] };
  const money = (n: any) => `${Number(n ?? 0).toFixed(2)} SAR`;

  const expByCat = new Map<string, number>();
  (expenses ?? []).forEach((e: any) => expByCat.set(e.category, (expByCat.get(e.category) ?? 0) + Number(e.amount || 0)));
  const expenseTotal = Array.from(expByCat.values()).reduce((a, b) => a + b, 0);
  const avgRating = (ratings ?? []).length ? ((ratings as any[]).reduce((a, x) => a + x.rating, 0) / (ratings as any[]).length) : null;
  const profit = Number(s.revenue ?? 0) - expenseTotal;

  return (
    <div className="max-w-5xl">
      <PageHeader title="Transport Reports">
        {canLedger && <Link href="/transport/reports/ledger" className="btn-outline text-sm">Trip Ledger →</Link>}
        <PrintButton />
      </PageHeader>
      <ReportRange from={from} to={to} />

      {error && <div className="card text-red-600">{error.message}</div>}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["Bookings", s.bookings ?? 0], ["Trips", s.trips ?? 0], ["Revenue", money(s.revenue)], ["Completed", s.completed ?? 0], ["Cancelled", s.cancelled ?? 0]].map(([l, v]) => (
          <div key={l as string} className="card text-center"><div className="text-xl font-bold text-slate-800">{v as any}</div><div className="text-xs text-slate-500">{l as string}</div></div>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Expenses", money(expenseTotal)], ["Est. Profit", money(profit)], ["Avg Rating", avgRating ? `${avgRating.toFixed(1)} ★` : "—"], ["Ratings", (ratings ?? []).length]].map(([l, v]) => (
          <div key={l as string} className="card text-center"><div className={`text-xl font-bold ${l === "Est. Profit" && profit < 0 ? "text-red-600" : "text-slate-800"}`}>{v as any}</div><div className="text-xs text-slate-500">{l as string}</div></div>
        ))}
      </div>

      {extra.monthly?.length > 1 && (
        <div className="card mb-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly Revenue Trend</h2>
          <TrendChart data={extra.monthly} xKey="month" series={[{ key: "revenue", label: "Revenue" }]} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Table title="Expenses by Category" cols={["Category", "Amount"]} rows={Array.from(expByCat.entries()).map(([k, v]) => [k, money(v)])} />
        <Table title="Revenue by Agent" cols={["Agent", "Bookings", "Revenue"]} rows={(r.by_agent ?? []).map((x: any) => [x.name, x.bookings, money(x.revenue)])} />
        <Table title="Country-wise Summary" cols={["Country", "Bookings", "Revenue"]} rows={(extra.by_country ?? []).map((x: any) => [x.country, x.bookings, money(x.revenue)])} />
        <Table title="Peak Routes" cols={["Route", "Trips"]} rows={(r.by_route ?? []).map((x: any) => [x.route, x.trips])} />
        <Table title="Vehicle Utilisation" cols={["Vehicle", "Trips"]} rows={(r.by_vehicle ?? []).map((x: any) => [x.vehicle, x.trips])} />
        <Table title="Driver Utilisation" cols={["Driver", "Trips"]} rows={(r.by_driver ?? []).map((x: any) => [x.driver, x.trips])} />
        <Table title="Daily Trips" cols={["Day", "Trips"]} rows={(r.daily ?? []).map((x: any) => [x.day, x.trips])} />
        <Table title="Cancelled Trips" cols={["Day", "Route", "Trips"]} rows={(r.cancelled_trips ?? []).map((x: any) => [x.day, x.route, x.trips])} />
      </div>

      <div className="mt-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Trip Detail</h2>
        <DataTable
          cols={[
            // Reuses the exact drilldown target TripAlerts already links a
            // trip to (operations board, that trip's day) — there is no
            // standalone trip-detail page/URL in the ERP, so this is the
            // real, existing screen a trip is actually looked at from.
            { key: "customer", label: "Customer", href: (row) => row.trip_date ? `/transport/operations?date=${row.trip_date}` : null },
            { key: "contact", label: "WhatsApp / Contact" },
            { key: "trip_date", label: "Travel Date", kind: "date" },
            { key: "route", label: "Route" },
            { key: "car", label: "Car" },
            { key: "amount", label: "Amount", kind: "money", total: true },
            { key: "status", label: "Status" },
          ]}
          rows={extra.trips ?? []}
          empty="No trips for this period."
        />
      </div>
    </div>
  );
}
