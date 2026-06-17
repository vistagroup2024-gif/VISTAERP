import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function HotelsPage() {
  const supabase = createClient();
  const { data: hotels } = await supabase
    .from("hotels")
    .select("id, name, city, rating, distance_haram_m, is_active, room_types(count)")
    .order("city");

  return (
    <div>
      <PageHeader title="Hotels" action={{ href: "/hotels/new", label: "+ New Hotel" }} />
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Hotel</th>
              <th className="th">City</th>
              <th className="th">Rating</th>
              <th className="th">Distance to Haram</th>
              <th className="th">Room types</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {(hotels ?? []).map((h: any) => (
              <tr key={h.id} className="border-t border-slate-100">
                <td className="td font-medium">
                  <Link href={`/hotels/${h.id}`} className="text-brand hover:underline">
                    {h.name}
                  </Link>
                </td>
                <td className="td capitalize">{h.city}</td>
                <td className="td">{h.rating ? `${h.rating}★` : "—"}</td>
                <td className="td">{h.distance_haram_m ? `${h.distance_haram_m} m` : "—"}</td>
                <td className="td">{h.room_types?.[0]?.count ?? 0}</td>
                <td className="td">
                  <span className={`badge ${h.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    {h.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
              </tr>
            ))}
            {(hotels ?? []).length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={6}>No hotels yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
