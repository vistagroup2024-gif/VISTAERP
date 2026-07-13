import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { Brn, Consumption, nightsBetween, usedOnNight, cellClass, fmtDay } from "@/lib/brn";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const supabase = createClient();
  const [{ data: brns }, { data: cons }] = await Promise.all([
    supabase.from("brn_inventory").select("*").order("hotel_name").order("check_in"),
    supabase.from("brn_consumption").select("*"),
  ]);

  const B = (brns ?? []) as Brn[];
  const C = (cons ?? []) as Consumption[];
  const consByBrn: Record<string, Consumption[]> = {};
  C.forEach((c) => (consByBrn[c.brn_id] ||= []).push(c));

  // Global date span across all BRNs
  let allDays: string[] = [];
  if (B.length) {
    const min = B.reduce((m, b) => (b.check_in < m ? b.check_in : m), B[0].check_in);
    const max = B.reduce((m, b) => (b.check_out > m ? b.check_out : m), B[0].check_out);
    allDays = nightsBetween(min, max);
  }

  return (
    <div>
      <PageHeader title="Daily Inventory Calendar" />
      <p className="mb-4 text-sm text-slate-500">
        Available beds per night for each BRN.{" "}
        <span className="badge bg-green-100 text-green-700">healthy</span>{" "}
        <span className="badge bg-yellow-200 text-yellow-900">≤20%</span>{" "}
        <span className="badge bg-orange-400 text-white">full</span>{" "}
        <span className="badge bg-red-500 text-white">overbooked</span>
      </p>

      {B.length === 0 ? (
        <div className="card text-slate-400">No BRN inventory yet.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-max text-center text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th sticky left-0 z-10 bg-slate-50 text-left">BRN / Hotel</th>
                {allDays.map((d) => (
                  <th key={d} className="th whitespace-nowrap px-2">{fmtDay(d)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {B.map((b) => {
                const own = consByBrn[b.id] ?? [];
                const span = new Set(nightsBetween(b.check_in, b.check_out));
                return (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="td sticky left-0 z-10 bg-white text-left">
                      <div className="font-mono text-xs font-semibold">{b.brn}</div>
                      <div className="text-xs text-slate-500">{b.hotel_name}</div>
                    </td>
                    {allDays.map((d) => {
                      if (!span.has(d)) return <td key={d} className="td bg-slate-50/50"></td>;
                      const avail = b.beds - usedOnNight(d, own);
                      return <td key={d} className={`td ${cellClass(avail, b.beds)}`}>{avail}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
