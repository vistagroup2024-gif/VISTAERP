import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import CompanyFilter from "@/components/CompanyFilter";
import { dateStr } from "@/lib/format";
import { Brn, Consumption, isArchived, dailyForBrn } from "@/lib/brn";

export const dynamic = "force-dynamic";

export default async function ArchivedBrnsPage({ searchParams }: { searchParams: { company?: string } }) {
  const company = searchParams.company ?? "";
  const supabase = createClient();
  const [{ data: brns }, { data: cons }, { data: companies }] = await Promise.all([
    supabase.from("brn_inventory").select("*, parties:supplier_id(name), group_companies:group_company_id(name)").order("check_out"),
    supabase.from("brn_consumption").select("*"),
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
      <p className="mb-4 text-sm text-slate-500">
        BRNs with no beds left on any night. They return to the Active list automatically if inventory is restored (cancellation, reallocation, adjustment).
      </p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[980px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Company</th>
              <th className="th">BRN</th>
              <th className="th">Hotel</th>
              <th className="th">Supplier</th>
              <th className="th">Check-in</th>
              <th className="th">Check-out</th>
              <th className="th">Original Beds</th>
              <th className="th">Beds Consumed</th>
              <th className="th">Fully Consumed On</th>
              <th className="th">History</th>
            </tr>
          </thead>
          <tbody>
            {archived.map(({ b, peakUsed, fullyOn, history }) => (
              <tr key={b.id} className="border-t border-slate-100">
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
