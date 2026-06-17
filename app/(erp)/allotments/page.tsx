import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { dateStr, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AllotmentsPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("allotments")
    .select("id, rooms_held, start_date, end_date, release_date, cost_price, currency, status, hotels(name, city), room_types(name)")
    .order("start_date", { ascending: false });

  return (
    <div>
      <PageHeader title="Hotel Allotments (held inventory)" action={{ href: "/allotments/new", label: "+ New Allotment" }} />
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Hotel</th>
              <th className="th">Room type</th>
              <th className="th">Rooms held</th>
              <th className="th">Stay window</th>
              <th className="th">Release by</th>
              <th className="th text-right">Cost/night</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r: any) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td font-medium">{r.hotels?.name} <span className="capitalize text-slate-400">({r.hotels?.city})</span></td>
                <td className="td">{r.room_types?.name}</td>
                <td className="td">{r.rooms_held}</td>
                <td className="td">{dateStr(r.start_date)} – {dateStr(r.end_date)}</td>
                <td className="td">{dateStr(r.release_date)}</td>
                <td className="td text-right">{money(r.cost_price, r.currency)}</td>
                <td className="td"><span className="badge bg-green-100 text-green-700">{r.status}</span></td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr><td className="td text-slate-400" colSpan={7}>No allotments yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
