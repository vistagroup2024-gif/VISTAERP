import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import CompanyFilter from "@/components/CompanyFilter";
import { dateStr } from "@/lib/format";
import { totalNights } from "@/lib/brn";
import ReleaseButton from "./ReleaseButton";

export const dynamic = "force-dynamic";

// The Archived BRNs screen right next to this one already narrows by
// group company (CompanyFilter) — History had no filter at all, so a
// multi-company book made this list unscannable. Same single-select
// company filter, same pattern: company is a workspace partition here
// (which legal entity's BRNs), not an additive report criterion, so it
// stays single-select like every other CompanyFilter use in the ERP.
export default async function HistoryPage({ searchParams }: { searchParams: { company?: string } }) {
  await guardStaffPage("brn.view");
  const company = searchParams.company ?? "";
  const supabase = createClient();
  let query = supabase
    .from("brn_consumption")
    .select(`id, reference, check_in, check_out, beds, created_at,
      brn_inventory:brn_id${company ? "!inner" : ""}(brn, hotel_name, group_company_id)`)
    .order("created_at", { ascending: false })
    .limit(500);
  if (company) query = query.eq("brn_inventory.group_company_id", company);
  const [{ data: rows }, { data: companies }] = await Promise.all([
    query,
    supabase.from("group_companies").select("id, name").order("name"),
  ]);

  const R = rows ?? [];

  return (
    <div>
      <PageHeader title="Inventory History" />
      <CompanyFilter companies={companies ?? []} value={company} />
      <div className="card overflow-x-auto p-0">
        <table className="report-grid w-full min-w-[720px]">
          <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
            <tr>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">Booked</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">BRN</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">Hotel</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">Reference</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">Stay</span></th>
              <th className="px-4 py-2.5 text-right"><span className="col-resize">Beds</span></th>
              <th className="px-4 py-2.5 text-right"><span className="col-resize">Bed-Nights</span></th>
              <th className="px-4 py-2.5 text-left"><span className="col-resize">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {R.map((r: any, i) => (
              <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-100/80" : ""}`}>
                <td className="td text-sm text-slate-400">{dateStr(r.created_at)}</td>
                <td className="td font-mono">{r.brn_inventory?.brn ?? "—"}</td>
                <td className="td">{r.brn_inventory?.hotel_name ?? "—"}</td>
                <td className="td">{r.reference ?? "—"}</td>
                <td className="td text-sm">{dateStr(r.check_in)} → {dateStr(r.check_out)}</td>
                <td className="td text-right font-medium">{r.beds}</td>
                <td className="td text-right">{r.beds * totalNights(r.check_in, r.check_out)}</td>
                <td className="td"><ReleaseButton consumptionId={r.id} /></td>
              </tr>
            ))}
            {R.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No consumption history yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
