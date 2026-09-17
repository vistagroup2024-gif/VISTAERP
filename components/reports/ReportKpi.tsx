import Icon, { type IconName } from "@/components/ui/Icon";

type Tone = "pos" | "neg" | "warn" | "info";
const TONE: Record<Tone, string> = {
  pos: "text-emerald-600", neg: "text-red-600", warn: "text-amber-600", info: "text-brand-700",
};

/** The KPI tile a report's own summary row uses. Header is the same solid
 *  brand green as SectionHeader — deliberately darker than the report's own
 *  grid header — so the two read as one system across a page: a report
 *  screen carries the dark green up top, and the grid it's summarising is
 *  the lighter tint below. */
export default function ReportKpi({ label, value, icon, tone }: {
  label: string; value: string; icon?: IconName; tone?: Tone;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-1.5 bg-brand-700 px-3 py-1.5">
        {icon && <Icon name={icon} size={13} className="shrink-0 text-brand-200" />}
        <p className="truncate text-[11px] font-bold uppercase tracking-wide text-white">{label}</p>
      </div>
      <p className={`px-3 py-2 text-xl font-bold tabular-nums ${tone ? TONE[tone] : "text-slate-800"}`}>{value}</p>
    </div>
  );
}
