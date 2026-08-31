// Minimal, elegant bar chart — inline SVG, single brand color, no library.
// Used for trend panels on dashboards. Values are real; bars scale to the max.
export default function MiniBars({
  data, height = 160, format,
}: {
  data: { label: string; value: number }[];
  height?: number;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const fmt = format ?? ((n: number) => String(n));
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {data.map((d, i) => {
        const h = Math.round((d.value / max) * (height - 34));
        return (
          <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
            <span className="text-[11px] font-medium tabular-nums text-slate-500">{d.value ? fmt(d.value) : ""}</span>
            <div
              className="w-full max-w-[46px] rounded-t bg-brand-500/85 transition-all"
              style={{ height: Math.max(2, h) }}
              title={`${d.label}: ${fmt(d.value)}`}
            />
            <span className="truncate text-[11px] text-slate-400">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
