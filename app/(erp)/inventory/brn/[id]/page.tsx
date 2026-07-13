import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { dateStr } from "@/lib/format";
import { Brn, Consumption, dailyForBrn, cellClass, fmtDay } from "@/lib/brn";
import BrnActions from "./BrnActions";

export const dynamic = "force-dynamic";

export default async function BrnDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: brn } = await supabase.from("brn_inventory").select("*").eq("id", params.id).single();
  if (!brn) notFound();

  const { data: cons } = await supabase
    .from("brn_consumption").select("*").eq("brn_id", params.id).order("check_in");

  const b = brn as Brn;
  const C = (cons ?? []) as Consumption[];
  const daily = dailyForBrn(b, C);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{b.hotel_name}</h1>
          <p className="text-slate-500">
            <span className="font-mono">{b.brn}</span>
            {b.city ? ` · ${b.city}` : ""} · {dateStr(b.check_in)} → {dateStr(b.check_out)} · {b.beds} beds
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Link href={`/inventory/consume?brn=${b.id}`} className="btn">Consume beds</Link>
          <BrnActions brnId={b.id} canDelete={C.length === 0} />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <p className="mb-3 font-semibold text-slate-700">Daily availability</p>
        <table className="min-w-max text-center text-sm">
          <thead>
            <tr>
              <th className="th sticky left-0 bg-white text-left">Date</th>
              {daily.map((d) => <th key={d.day} className="th whitespace-nowrap px-3">{fmtDay(d.day)}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="td sticky left-0 bg-white text-left font-medium text-slate-500">Capacity</td>
              {daily.map((d) => <td key={d.day} className="td">{d.capacity}</td>)}
            </tr>
            <tr>
              <td className="td sticky left-0 bg-white text-left font-medium text-slate-500">Used</td>
              {daily.map((d) => <td key={d.day} className="td">{d.used}</td>)}
            </tr>
            <tr>
              <td className="td sticky left-0 bg-white text-left font-medium text-slate-500">Available</td>
              {daily.map((d) => (
                <td key={d.day} className={`td ${cellClass(d.available, d.capacity)}`}>{d.available}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto p-0">
        <p className="px-4 pt-4 font-semibold text-slate-700">Consumption ({C.length})</p>
        <table className="mt-2 w-full min-w-[600px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Reference</th>
              <th className="th">Stay</th>
              <th className="th text-right">Beds</th>
              <th className="th">Booked</th>
            </tr>
          </thead>
          <tbody>
            {C.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="td">{c.reference ?? "—"}</td>
                <td className="td text-sm">{dateStr(c.check_in)} → {dateStr(c.check_out)}</td>
                <td className="td text-right font-medium">{c.beds}</td>
                <td className="td text-sm text-slate-400">{dateStr((c as any).created_at)}</td>
              </tr>
            ))}
            {C.length === 0 && <tr><td className="td text-slate-400" colSpan={4}>No consumption yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
