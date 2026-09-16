"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

// A small fixed categorical order drawn from the app's own palette (brand
// green, then the semantic colors already used for meaning elsewhere) —
// never cycled, never regenerated per render. A slice count beyond this
// folds into "Other" rather than growing the palette.
const COLORS = ["#0b6a58", "#1d4ed8", "#b45309", "#94a3b8", "#b91c1c", "#4a9d86"];
const MAX_SLICES = 6;

const money = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

/** A composition view — each account/category's share of one total. Used
 *  sparingly, only where "what's the split" is itself the useful question
 *  (Cash & Bank's cash-vs-bank share), not as decoration. */
export default function DonutChart({ data, nameKey, valueKey, height = 220 }: {
  data: Record<string, any>[];
  nameKey: string;
  valueKey: string;
  height?: number;
}) {
  const sorted = [...data].filter((d) => Math.abs(Number(d[valueKey]) || 0) > 0).sort((a, b) => Math.abs(b[valueKey]) - Math.abs(a[valueKey]));
  const shown = sorted.slice(0, MAX_SLICES - 1);
  const rest = sorted.slice(MAX_SLICES - 1);
  const restTotal = rest.reduce((s, d) => s + Math.abs(Number(d[valueKey]) || 0), 0);
  const rows = rest.length ? [...shown, { [nameKey]: "Other", [valueKey]: restTotal }] : shown;

  if (rows.length === 0) return <p className="py-8 text-center text-sm text-slate-400">Nothing to show.</p>;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={rows} dataKey={valueKey} nameKey={nameKey} innerRadius="55%" outerRadius="85%" paddingAngle={2}>
          {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="#fff" strokeWidth={2} />)}
        </Pie>
        <Tooltip formatter={(v: any) => money(Math.abs(Number(v)))} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
