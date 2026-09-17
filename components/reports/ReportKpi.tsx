import Icon, { type IconName } from "@/components/ui/Icon";

type Tone = "pos" | "neg" | "warn" | "info";
const TONE: Record<Tone, string> = {
  pos: "text-emerald-600", neg: "text-red-600", warn: "text-amber-600", info: "text-brand-700",
};

/** The KPI tile a report's own summary row uses — same tinted-header-plus-
 *  value shape as the dashboard's own cards (components/dashboard/
 *  DashboardCard.tsx), so a report and the dashboard read as one visual
 *  language instead of a colourful dashboard and a plain white report. Kept
 *  to a single figure per tile (a report KPI answers one question at a
 *  glance); a card needing several numbers together belongs on the
 *  dashboard itself, not reinvented here. */
export default function ReportKpi({ label, value, icon, tone }: {
  label: string; value: string; icon?: IconName; tone?: Tone;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-brand-100 bg-brand-100/50 px-3 py-1.5">
        {icon && <Icon name={icon} size={13} className="shrink-0 text-brand-400" />}
        <p className="truncate text-[11px] font-bold uppercase tracking-wide text-brand-700">{label}</p>
      </div>
      <p className={`px-3 py-2 text-xl font-bold tabular-nums ${tone ? TONE[tone] : "text-slate-800"}`}>{value}</p>
    </div>
  );
}
