import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import CompanyFilter from "@/components/CompanyFilter";
import { Brn, Consumption, usedOnNight, cellClass, maxNightlyAvailable } from "@/lib/brn";
import CalendarControls from "./CalendarControls";

export const dynamic = "force-dynamic";

function pad(n: number) { return String(n).padStart(2, "0"); }

export default async function CalendarPage({
  searchParams,
}: { searchParams: { month?: string; year?: string; city?: string; company?: string } }) {
  const now = new Date();
  const month = Number(searchParams.month ?? now.getUTCMonth() + 1); // 1-12
  const year = Number(searchParams.year ?? now.getUTCFullYear());
  const city = searchParams.city ?? "Makkah";
  const company = searchParams.company ?? "";

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthStart = `${year}-${pad(month)}-01`;
  const monthEnd = `${year}-${pad(month)}-${pad(daysInMonth)}`;
  const days = Array.from({ length: daysInMonth }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);

  const supabase = createClient();
  // BRNs of this city whose coverage overlaps the month
  let brnQuery = supabase.from("brn_inventory").select("*")
    .eq("city", city).lte("check_in", monthEnd).gt("check_out", monthStart).order("hotel_name");
  if (company) brnQuery = brnQuery.eq("group_company_id", company);
  const [{ data: brns }, { data: cons }, { data: companies }] = await Promise.all([
    brnQuery,
    supabase.from("brn_consumption").select("*"),
    supabase.from("group_companies").select("id, name").order("name"),
  ]);

  const C = (cons ?? []) as Consumption[];
  const consByBrn: Record<string, Consumption[]> = {};
  C.forEach((c) => (consByBrn[c.brn_id] ||= []).push(c));
  // Daily Calendar shows only usable inventory — hide fully-consumed BRNs
  // (they remain in BRN History, Archived BRNs and Reports).
  const B = ((brns ?? []) as Brn[]).filter((b) => maxNightlyAvailable(b, consByBrn[b.id] ?? []) > 0);

  // availability matrix: brn -> day -> available (or null if not covered that night)
  function avail(b: Brn, day: string): number | null {
    if (!(b.check_in <= day && b.check_out > day)) return null; // checkout day excluded
    return b.beds - usedOnNight(day, consByBrn[b.id] ?? []);
  }
  const totals = days.map((day) =>
    B.reduce((sum, b) => {
      const a = avail(b, day);
      return a === null ? sum : sum + a;
    }, 0)
  );

  return (
    <div>
      <PageHeader title="Inventory Calendar" />
      <CompanyFilter companies={companies ?? []} value={company} />
      <CalendarControls month={month} year={year} city={city} />
      <p className="mb-3 text-sm text-slate-500">
        Available beds per night for each <b>{city}</b> BRN. Checkout day is never counted.
      </p>

      {B.length === 0 ? (
        <div className="card text-slate-400">No {city} BRN inventory in this month.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-max border-collapse text-center text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="th sticky left-0 z-10 bg-slate-50 text-left">BRN / Hotel</th>
                {days.map((d, i) => (
                  <th key={d} className="th px-2 py-2">{i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {B.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="td sticky left-0 z-10 bg-white text-left">
                    <div className="font-mono text-xs font-semibold">{b.brn}</div>
                    <div className="text-[11px] text-slate-500">{b.hotel_name}</div>
                  </td>
                  {days.map((d) => {
                    const a = avail(b, d);
                    if (a === null) return <td key={d} className="td bg-slate-50/40 px-2"></td>;
                    return <td key={d} className={`td px-2 ${cellClass(a, b.beds)}`}>{a}</td>;
                  })}
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <td className="td sticky left-0 z-10 bg-slate-50 text-left">TOTAL AVAILABLE</td>
                {totals.map((t, i) => (
                  <td key={i} className="td px-2">{t}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
