"use client";

import { useRouter } from "next/navigation";

function shift(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ScheduleDateNav({ date, today, tomorrow }: { date: string; today: string; tomorrow: string }) {
  const router = useRouter();
  const go = (d: string) => router.push(`/agent/module/transport/schedule?date=${d}`);
  const btn = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-brand text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={btn(date === today)} onClick={() => go(today)}>Today</button>
      <button className={btn(date === tomorrow)} onClick={() => go(tomorrow)}>Tomorrow</button>
      <div className="ml-1 flex items-center gap-1">
        <button className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-600 hover:bg-slate-50" onClick={() => go(shift(date, -1))} aria-label="Previous day">←</button>
        <input type="date" value={date} onChange={(e) => e.target.value && go(e.target.value)} className="input px-2 py-1.5 text-sm" />
        <button className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-600 hover:bg-slate-50" onClick={() => go(shift(date, 1))} aria-label="Next day">→</button>
      </div>
    </div>
  );
}
