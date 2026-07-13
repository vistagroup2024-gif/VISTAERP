import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { Brn, Consumption, nightsBetween, usedOnNight, fmtDay } from "@/lib/brn";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: { city?: string } }) {
  const city = searchParams.city ?? "Makkah";
  const supabase = createClient();
  const [{ data: brns }, { data: cons }] = await Promise.all([
    supabase.from("brn_inventory").select("*").eq("city", city).order("check_in"),
    supabase.from("brn_consumption").select("*"),
  ]);

  const B = (brns ?? []) as Brn[];
  const C = (cons ?? []) as Consumption[];
  const consByBrn: Record<string, Consumption[]> = {};
  C.forEach((c) => (consByBrn[c.brn_id] ||= []).push(c));

  // Global date span
  let allDays: string[] = [];
  if (B.length) {
    const min = B.reduce((m, b) => (b.check_in < m ? b.check_in : m), B[0].check_in);
    const max = B.reduce((m, b) => (b.check_out > m ? b.check_out : m), B[0].check_out);
    allDays = nightsBetween(min, max);
  }

  // Total available beds across all BRNs of this city, per night
  const perNight = allDays.map((day) => {
    let capacity = 0, used = 0;
    for (const b of B) {
      if (b.check_in <= day && b.check_out > day) {
        capacity += b.beds;
        used += usedOnNight(day, consByBrn[b.id] ?? []);
      }
    }
    return { day, capacity, used, available: capacity - used };
  });

  const tabs = ["Makkah", "Madinah", "Jeddah"];

  return (
    <div>
      <PageHeader title="Daily Inventory Calendar" />
      <div className="mb-4 flex gap-2">
        {tabs.map((c) => (
          <Link key={c} href={`/inventory/calendar?city=${c}`}
            className={`rounded-md px-4 py-2 text-sm font-medium ${c === city ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {c}
          </Link>
        ))}
      </div>
      <p className="mb-4 text-sm text-slate-500">Total available beds across all active <b>{city}</b> BRNs, per night.</p>

      {perNight.length === 0 ? (
        <div className="card text-slate-400">No {city} BRN inventory yet.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Date</th>
                <th className="th text-right">Total Capacity</th>
                <th className="th text-right">Consumed</th>
                <th className="th text-right">Available Beds</th>
              </tr>
            </thead>
            <tbody>
              {perNight.map((n) => (
                <tr key={n.day} className="border-t border-slate-100">
                  <td className="td font-medium">{fmtDay(n.day)}</td>
                  <td className="td text-right text-slate-500">{n.capacity}</td>
                  <td className="td text-right text-slate-500">{n.used}</td>
                  <td className={`td text-right font-semibold ${n.available < 0 ? "text-red-600" : n.available === 0 ? "text-orange-600" : "text-green-700"}`}>
                    {n.available}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
