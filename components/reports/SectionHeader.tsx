/** A report's own section title — the same tinted-pill look ReportKpi and
 *  the dashboard's cards already use, so a page with several grids reads
 *  apart at a glance instead of every section heading being the same flat
 *  grey text. */
export default function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-2">
      <h2 className="inline-block rounded-md bg-brand-100/70 px-2.5 py-1 text-sm font-bold text-brand-700">{title}</h2>
      {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
    </div>
  );
}
