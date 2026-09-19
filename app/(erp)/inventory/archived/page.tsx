import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import CompanyFilter from "@/components/CompanyFilter";
import { dateStr } from "@/lib/format";
import { Brn, Consumption, isArchived, dailyForBrn } from "@/lib/brn";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

export const dynamic = "force-dynamic";

export default async function ArchivedBrnsPage({ searchParams }: { searchParams: { company?: string } }) {
  await guardStaffPage("brn.view");
  const company = searchParams.company ?? "";
  const supabase = createClient();
  const [{ data: brns }, { data: cons }, { data: companies }] = await Promise.all([
    supabase.from("brn_inventory").select("*, parties:supplier_id(name), group_companies:group_company_id(name)").order("check_out"),
    fetchAllRows<Consumption>((from, to) => supabase.from("brn_consumption").select("*").order("id").range(from, to)),
    supabase.from("group_companies").select("id, name").order("name"),
  ]);

  const B = (brns ?? []) as any[];
  const C = (cons ?? []) as Consumption[];
  const consByBrn: Record<string, Consumption[]> = {};
  C.forEach((c) => (consByBrn[c.brn_id] ||= []).push(c));

  const archived = B
    .filter((b) => isArchived(b as Brn, consByBrn[b.id] ?? []))
    .filter((b) => !company || b.group_company_id === company)
    .map((b) => {
      const own = consByBrn[b.id] ?? [];
      const daily = dailyForBrn(b as Brn, own);
      const peakUsed = daily.reduce((m, d) => Math.max(m, d.used), 0);
      const fullyOn = own.reduce((mx, c) => { const ca = c.created_at ?? ""; return ca > mx ? ca : mx; }, "");
      return { b, peakUsed, fullyOn, history: own.length };
    });

  return (
    <div>
      <PageHeader title="Archived BRNs (Fully Consumed)" />
      <CompanyFilter companies={companies ?? []} value={company} />
      <div className="card overflow-x-auto p-0">
        <table className="report-grid w-full min-w-[980px]">
          <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
            <tr>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">Company</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">BRN</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">Hotel</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">Supplier</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">Check-in</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">Check-out</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">Original Beds</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">Beds Consumed</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">Fully Consumed On</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">History</span></th>
            </tr>
          </thead>
          <tbody>
            {archived.map(({ b, peakUsed, fullyOn, history }, i) => (
              <tr key={b.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-100/80" : ""}`}>
                <td className="td text-slate-500">{b.group_companies?.name ?? "—"}</td>
                <td className="td font-mono font-medium">
                  <Link href={`/inventory/brn/${b.id}`} className="text-brand hover:underline">{b.brn}</Link>
                </td>
                <td className="td">{b.hotel_name}</td>
                <td className="td text-slate-500">{b.parties?.name ?? "—"}</td>
                <td className="td whitespace-nowrap">{dateStr(b.check_in)}</td>
                <td className="td whitespace-nowrap">{dateStr(b.check_out)}</td>
                <td className="td">{b.beds}</td>
                <td className="td font-medium">{peakUsed}</td>
                <td className="td whitespace-nowrap text-sm text-slate-500">{fullyOn ? dateStr(fullyOn) : "—"}</td>
                <td className="td">
                  <Link href={`/inventory/brn/${b.id}`} className="text-brand text-sm hover:underline">{history} record(s)</Link>
                </td>
              </tr>
            ))}
            {archived.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={10}>No archived BRNs.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
