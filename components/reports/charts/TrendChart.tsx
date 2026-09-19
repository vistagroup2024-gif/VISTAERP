"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Vista green (brand-600) for the primary series, slate-400 for a reference
// series (a target/budget line) — the app's own two-tone palette rather than
// a generated categorical set, since a trend chart here never carries more
// than "actual" and one reference.
const COLORS = ["#0b6a58", "#94a3b8"];
const NEG_COLOR = "#dc2626"; // text-red-600 — same "a loss reads red" rule DataTable's negativeClass() applies to every grid cell

export interface TrendSeries {
  key: string; label: string; color?: string;
  // A fixed `fill` paints every bar of a series the same color regardless of
  // its value — fine for Sales/Revenue/Purchases, which are never
  // legitimately negative or "too high" in a way worth flagging, but wrong
  // for a figure where one particular bar deserves its own red: a real
  // August loss on P&L's own "Monthwise Net Profit" chart still reading
  // green, or an expense month that ran well above every other month not
  // standing out at all. `redWhen` is the one hook for both: a predicate
  // run against each bar's own value, red when it returns true. The caller
  // decides what "red" means for its own series — `(v) => v < 0` for a
  // loss, `(v) => v > average` for an above-average expense month — this
  // component stays a dumb renderer either way.
  redWhen?: (value: number) => boolean;
}

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
        {series.map((s, i) => {
          const base = s.color ?? COLORS[i % COLORS.length];
          return (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={base} radius={[3, 3, 0, 0]} maxBarSize={36}>
              {s.redWhen && data.map((d, di) => (
                <Cell key={di} fill={s.redWhen!(Number(d[s.key])) ? NEG_COLOR : base} />
              ))}
            </Bar>
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}
