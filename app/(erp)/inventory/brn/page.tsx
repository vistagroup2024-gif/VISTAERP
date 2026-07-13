import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { dateStr } from "@/lib/format";
import { Brn, Consumption, dailyForBrn, totalNights } from "@/lib/brn";

export const dynamic = "force-dynamic";

export default async function BrnListPage() {
  const supabase = createClient();
  const [{ data: brns }, { data: cons }] = await Promise.all([
    supabase.from("brn_inventory").select("*").order("check_in"),
    supabase.from("brn_consumption").select("*"),
  ]);

  const B = (brns ?? []) as Brn[];
  const C = (cons ?? []) as Consumption[];
  const consByBrn: Record<string, Consumption[]> = {};
  C.forEach((c) => (consByBrn[c.brn_id] ||= []).push(c));

  return (
    <div>
      <PageHeader title="BRN Inventory" action={{ href: "/inventory/brn/new", label: "+ Add BRN" }} />
      <p className="mb-4 text-sm text-slate-500">All purchased hotel bed agreements. Click a BRN to see its daily availability.</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">BRN</th>
              <th className="th">Hotel</th>
              <th className="th">City</th>
              <th className="th">Stay</th>
              <th className="th text-right">Beds</th>
              <th className="th text-right">Peak Used</th>
              <th className="th text-right">Min Avail.</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {B.map((b) => {
              const daily = dailyForBrn(b, consByBrn[b.id] ?? []);
              const peakUsed = daily.reduce((m, d) => Math.max(m, d.used), 0);
              const minAvail = daily.reduce((m, d) => Math.min(m, d.available), b.beds);
              const nights = totalNights(b.check_in, b.check_out);
              return (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="td font-mono font-medium">
                    <Link href={`/inventory/brn/${b.id}`} className="text-brand hover:underline">{b.brn}</Link>
                  </td>
                  <td className="td">{b.hotel_name}</td>
                  <td className="td text-slate-500">{b.city ?? "—"}</td>
                  <td className="td text-sm">
                    {dateStr(b.check_in)} → {dateStr(b.check_out)}
                    <span className="ml-1 text-slate-400">({nights}n)</span>
                  </td>
                  <td className="td text-right font-medium">{b.beds}</td>
                  <td className="td text-right">{peakUsed}</td>
                  <td className="td text-right">
                    {minAvail < 0 ? (
                      <span className="badge bg-red-500 text-white">{minAvail} ⚠</span>
                    ) : minAvail === 0 ? (
                      <span className="badge bg-orange-400 text-white">Full</span>
                    ) : (
                      <span className="badge bg-green-100 text-green-700">{minAvail}</span>
                    )}
                  </td>
                  <td className="td text-right">
                    <Link href={`/inventory/consume?brn=${b.id}`} className="text-brand text-sm hover:underline">Consume</Link>
                  </td>
                </tr>
              );
            })}
            {B.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={8}>No BRN inventory yet. Click “Add BRN” to start.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
