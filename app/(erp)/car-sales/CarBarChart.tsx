"use client";

// Lightweight dependency-free bar chart (two series) for the Car Sales dashboard.
import { sar } from "./lib";

export default function CarBarChart({ data, series }: {
  data: { label: string; a: number; b: number }[];
  series: { a: string; b: string };
}) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.a, d.b)));
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-brand" /> {series.a}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-emerald-400" /> {series.b}</span>
      </div>
      <div className="flex items-end gap-3" style={{ height: 160 }}>
        {data.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
            <div className="flex w-full items-end justify-center gap-1" style={{ height: 130 }}>
              <div className="w-1/2 rounded-t bg-brand" style={{ height: `${(d.a / max) * 100}%` }} title={`${series.a}: ${sar(d.a)}`} />
              <div className="w-1/2 rounded-t bg-emerald-400" style={{ height: `${(d.b / max) * 100}%` }} title={`${series.b}: ${sar(d.b)}`} />
            </div>
            <div className="text-[11px] text-slate-500">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
