import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { getStaffAccess, staffCan, getSessionUser } from "@/lib/staffSession";
import LedgerRange from "./LedgerRange";
import LedgerTable from "./LedgerTable";

export const dynamic = "force-dynamic";

function monthStart() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }

export default async function TransportLedgerPage({ searchParams }: { searchParams: { from?: string; to?: string; pending?: string } }) {
  const access = await getStaffAccess();
  if (!staffCan(access, "transport.trip_ledger")) {
    return <div className="card m-6 text-slate-500">You don’t have permission to view the Transport Trip Ledger.</div>;
  }
  const sb = createClient();
  const user = await getSessionUser();
  const { data: roleRows } = await sb.from("user_roles").select("role").eq("user_id", user?.id ?? "");
  const isAdmin = (roleRows ?? []).some((r: any) => r.role === "admin");
  const today = new Date().toISOString().slice(0, 10);
  const from = searchParams.from || monthStart();
  const to = searchParams.to || today;
  const pendingOnly = searchParams.pending === "1";

  const { data, error } = await sb.rpc("transport_trip_ledger", { p_from: from, p_to: to });
  const all: any[] = (data as any[]) ?? [];
  const pendingCount = all.filter((r) => !r.invoice_created).length;
  const rows = pendingOnly ? all.filter((r) => !r.invoice_created) : all;

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

      <LedgerTable rows={rows} isAdmin={isAdmin} />
    </div>
  );
}
