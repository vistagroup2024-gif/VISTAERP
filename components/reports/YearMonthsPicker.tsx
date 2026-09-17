"use client";

import { MONTH_LABELS, type YearMonths } from "@/lib/reports/period";

// The compact period control every "analyse by month/year" report shares —
// not the generic As-At/From-To/Run-report form. Defaults to the current
// year with every month ticked (the caller passes that in as `value`), so
// the report is never empty on first paint; every change here applies
// immediately, there is no Run button.
export default function YearMonthsPicker({ value, onChange }: { value: YearMonths; onChange: (v: YearMonths) => void }) {
  const allOn = value.months.length === 12;
  const toggleMonth = (m: number) => {
    const has = value.months.includes(m);
    const next = has ? value.months.filter((x) => x !== m) : [...value.months, m];
    if (next.length > 0) onChange({ ...value, months: next.sort((a, b) => a - b) });
  };

  return (
    <div className="card flex flex-wrap items-center gap-3 print:hidden">
      <div className="flex items-center gap-1.5">
        <label className="label mb-0">Year</label>
        <button className="btn-outline h-8 w-8 p-0 text-sm" onClick={() => onChange({ ...value, year: value.year - 1 })} aria-label="Previous year">‹</button>
        <span className="w-14 text-center text-sm font-bold tabular-nums text-slate-800">{value.year}</span>
        <button className="btn-outline h-8 w-8 p-0 text-sm" onClick={() => onChange({ ...value, year: value.year + 1 })} aria-label="Next year">›</button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <label className="label mb-0 mr-1">Months</label>
        <button
          onClick={() => onChange({ ...value, months: allOn ? [] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${allOn ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
        >
          All
        </button>
        {MONTH_LABELS.map((label, i) => {
          const m = i + 1;
          const on = value.months.includes(m);
          return (
            <button key={m} onClick={() => toggleMonth(m)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${on ? "bg-brand-100 text-brand-700" : "bg-slate-50 text-slate-400 hover:bg-slate-100"}`}>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
