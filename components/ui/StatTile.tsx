import Link from "next/link";
import Icon, { type IconName } from "@/components/ui/Icon";

// KPI tile for dashboards. Restrained: white surface, quiet label, prominent
// value, one muted icon. `tone` only tints the icon chip — the card stays
// neutral so a grid of tiles reads as one calm row, not a rainbow.
export default function StatTile({
  label, value, hint, icon, href, tone = "brand", emphasis = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: IconName;
  href?: string;
  tone?: "brand" | "neutral" | "success" | "warning" | "danger" | "info";
  emphasis?: boolean;
}) {
  const chip: Record<string, string> = {
    brand: "bg-brand-50 text-brand-600",
    neutral: "bg-slate-100 text-slate-500",
    success: "bg-success-soft text-success-fg",
    warning: "bg-warning-soft text-warning-fg",
    danger: "bg-danger-soft text-danger-fg",
    info: "bg-info-soft text-info-fg",
  };
  const inner = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-1.5 truncate font-bold tabular-nums text-slate-900 ${emphasis ? "text-2xl" : "text-xl"}`}>{value}</p>
        {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      </div>
      {icon && (
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${chip[tone]}`}>
          <Icon name={icon} size={18} />
        </span>
      )}
    </div>
  );
  const cls = "card transition-shadow hover:shadow-pop";
  return href ? <Link href={href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;
}
