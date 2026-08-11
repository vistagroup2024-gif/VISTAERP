import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { getStaffAccess, staffCan, getSessionUser } from "@/lib/staffSession";
import VisaLedgerRange from "./VisaLedgerRange";
import VisaLedgerTable from "./VisaLedgerTable";

export const dynamic = "force-dynamic";

function monthStart() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }

export default async function VisaInvoicesPage({ searchParams }: { searchParams: { from?: string; to?: string; pending?: string } }) {
  const access = await getStaffAccess();
  if (!staffCan(access, "visa.view")) {
    return <div className="card m-6 text-slate-500">You don’t have permission to view Visa Invoices.</div>;
  }
  const sb = createClient();
  const user = await getSessionUser();
  const { data: roleRows } = await sb.from("user_roles").select("role").eq("user_id", user?.id ?? "");
  const isAdmin = (roleRows ?? []).some((r: any) => r.role === "admin");
  const today = new Date().toISOString().slice(0, 10);
  const from = searchParams.from || monthStart();
  const to = searchParams.to || today;
  const pendingOnly = searchParams.pending === "1";

  const { data, error } = await sb.rpc("visa_invoice_ledger", { p_from: from, p_to: to });
  const all: any[] = (data as any[]) ?? [];
  const pendingCount = all.filter((r) => !r.invoice_created).length;
  const rows = pendingOnly ? all.filter((r) => !r.invoice_created) : all;

  const rangeQ = `from=${from}&to=${to}`;

  return (
    <div className="max-w-[1400px]">
      <PageHeader title="Visa Invoices"><PrintButton /></PageHeader>
      <VisaLedgerRange from={from} to={to} rows={rows} />
      {error && <div className="card text-red-600">{error.message}</div>}

      <div className="no-print mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span className={`rounded-full px-3 py-1 font-medium ${pendingCount ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
          {pendingCount ? `${pendingCount} invoice${pendingCount === 1 ? "" : "s"} pending` : "All invoiced ✓"}
        </span>
        {pendingOnly
          ? <Link href={`/visa/invoices?${rangeQ}`} className="text-brand hover:underline">Show all</Link>
          : <Link href={`/visa/invoices?${rangeQ}&pending=1`} className="text-brand hover:underline">Show pending invoices only</Link>}
      </div>

      <VisaLedgerTable rows={rows} isAdmin={isAdmin} />
    </div>
  );
}
