import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { dateStr } from "@/lib/format";
import { totalNights } from "@/lib/brn";
import ReleaseButton from "./ReleaseButton";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("brn_consumption")
    .select("id, reference, check_in, check_out, beds, created_at, brn_inventory:brn_id(brn, hotel_name)")
    .order("created_at", { ascending: false })
    .limit(500);

  const R = rows ?? [];

  return (
    <div>
      <PageHeader title="Inventory History" />
      <p className="mb-4 text-sm text-slate-500">Every consumption booked against a BRN, newest first.</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Booked</th>
              <th className="th">BRN</th>
              <th className="th">Hotel</th>
              <th className="th">Reference</th>
              <th className="th">Stay</th>
              <th className="th text-right">Beds</th>
              <th className="th text-right">Bed-Nights</th>
              <th className="th">Action</th>
            </tr>
          </thead>
          <tbody>
            {R.map((r: any) => (
              <tr key={r.id} className="border-t border-slate-100">
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
