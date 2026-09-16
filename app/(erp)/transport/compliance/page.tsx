import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import { todaySA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

type Doc = { id: string; entity: string; doc_name: string; expiry: string };

function daysFrom(today: string, expiry: string) {
  return Math.round((new Date(expiry + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000);
}

// Customer documents drill to Party Details (/accounting/customers/[id],
// which already shows Iqama and every other party field). Vehicle documents
// stay plain text: a Tag Area leaf has no per-node URL of its own — the
// Tag Areas master (components/accounting/TreeMaster.tsx) is a client-side
// tree with no id-in-URL selection to link into, and building one is a
// larger change than this report on its own calls for.
function Row({ d, today, kind }: { d: Doc; today: string; kind: "Vehicle" | "Customer" }) {
  const days = daysFrom(today, d.expiry);
  const overdue = days < 0;
  return (
    <tr className="border-t border-slate-100">
      <td className="td">{kind}</td>
      <td className="td font-medium text-slate-700">
        {kind === "Customer" ? <Link href={`/accounting/customers/${d.id}`} className="text-brand hover:underline">{d.entity}</Link> : d.entity}
      </td>
      <td className="td">{d.doc_name}</td>
      <td className="td">{d.expiry}</td>
      <td className={`td text-right font-medium ${overdue ? "text-red-600" : days <= 30 ? "text-amber-600" : "text-slate-500"}`}>
        {overdue ? `${-days}d overdue` : `${days}d`}
      </td>
    </tr>
  );
}

// Operations & Compliance Portal (item 14) — reads report_compliance_documents()
// (migration 419), which unions every filled-in expiry across the vehicle tag
// area master (Car Authorization, Car Insurance, Operation Card, Fahas) and
// the Vista Car Customer party details (Iqama, Driver Card, Driver License).
// Split into two lists, not one merged feed with colour tints: EXPIRED is the
// alert, everything else is a separate, ordinary worklist — that split was
// asked for explicitly, not a styling choice.
export default async function CompliancePortalPage() {
  const sb = createClient();
  const today = todaySA();
  const { data } = await sb.rpc("report_compliance_documents", { p_company: COMPANY_ID });
  const r: any = data ?? { vehicles: [], customers: [] };
  const vehicles: Doc[] = r.vehicles ?? [];
  const customers: Doc[] = r.customers ?? [];

  const all: { d: Doc; kind: "Vehicle" | "Customer" }[] = [
    ...vehicles.map((d) => ({ d, kind: "Vehicle" as const })),
    ...customers.map((d) => ({ d, kind: "Customer" as const })),
  ].sort((a, b) => a.d.expiry.localeCompare(b.d.expiry));

  const expired = all.filter((x) => daysFrom(today, x.d.expiry) < 0);
  const upcoming = all.filter((x) => daysFrom(today, x.d.expiry) >= 0);

  return (
    <div className="max-w-5xl">
      <PageHeader title="Compliance Portal" subtitle="Vehicle documents (Car Authorization, Insurance, Operation Card, Fahas) and Vista Car Customer documents (Iqama, Driver Card, Driver License) — filled in on the Tag Areas master and Party Details.">
        <PrintButton />
      </PageHeader>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card text-center">
          <p className="text-2xl font-bold text-red-600">{expired.length}</p>
          <p className="text-xs text-slate-500">Expired</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-amber-600">{upcoming.filter((x) => daysFrom(today, x.d.expiry) <= 30).length}</p>
          <p className="text-xs text-slate-500">Due within 30 days</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-slate-700">{all.length}</p>
          <p className="text-xs text-slate-500">Documents tracked</p>
        </div>
      </div>

      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700">
        <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> Expired
      </h2>
      <div className="card mb-6 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-red-50"><tr>
            <th className="th">Type</th><th className="th">Entity</th><th className="th">Document</th><th className="th">Expiry</th><th className="th text-right">Overdue</th>
          </tr></thead>
          <tbody>
            {expired.map((x, i) => <Row key={i} d={x.d} today={today} kind={x.kind} />)}
            {expired.length === 0 && <tr><td colSpan={5} className="td text-center text-slate-400">Nothing expired.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-slate-700">Valid</h2>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr>
            <th className="th">Type</th><th className="th">Entity</th><th className="th">Document</th><th className="th">Expiry</th><th className="th text-right">Remaining</th>
          </tr></thead>
          <tbody>
            {upcoming.map((x, i) => <Row key={i} d={x.d} today={today} kind={x.kind} />)}
            {upcoming.length === 0 && <tr><td colSpan={5} className="td text-center text-slate-400">No documents on file yet — fill them in on Tag Areas (vehicle leaves) or Party Details (Vista Car Customers).</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
