"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Vista green (brand-600) for the primary series, slate-400 for a reference
// series (a target/budget line) — the app's own two-tone palette rather than
// a generated categorical set, since a trend chart here never carries more
// than "actual" and one reference.
const COLORS = ["#0b6a58", "#94a3b8"];

export interface TrendSeries { key: string; label: string; color?: string }

const money = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

/** A monthly (or any categorical x-axis) bar trend — one series needs no
 *  legend (the title already names it), two or more always show one. */
export default function TrendChart({ data, xKey, series, height = 240 }: {
  data: Record<string, any>[];
  xKey: string;
  series: TrendSeries[];
  height?: number;
}) {
  if (data.length === 0) return <p className="py-8 text-center text-sm text-slate-400">Nothing to show for this period.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={money} width={56} />
        <Tooltip formatter={(v: any) => money(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} maxBarSize={36} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
