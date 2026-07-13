"use client";

import { useRouter } from "next/navigation";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function CalendarControls({
  month, year, city,
}: { month: number; year: number; city: string }) {
  const router = useRouter();
  const years = [year - 1, year, year + 1, year + 2];

  function go(next: { month?: number; year?: number; city?: string }) {
    const m = next.month ?? month;
    const y = next.year ?? year;
    const c = next.city ?? city;
    router.push(`/inventory/calendar?month=${m}&year=${y}&city=${c}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <select className="input w-auto" value={month} onChange={(e) => go({ month: Number(e.target.value) })}>
        {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>
      <select className="input w-auto" value={year} onChange={(e) => go({ year: Number(e.target.value) })}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <div className="ml-2 flex gap-1">
        {["Makkah", "Madinah", "Jeddah"].map((c) => (
          <button key={c} onClick={() => go({ city: c })}
            className={`rounded-md px-4 py-2 text-sm font-medium ${c === city ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
