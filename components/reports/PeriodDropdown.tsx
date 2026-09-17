"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { MONTH_LABELS, periodLabel, type YearMonths } from "@/lib/reports/period";

/**
 * The compact, header-placed period control — the ERP-wide standard for
 * "which year/months am I looking at", meant to sit beside a report's title
 * or tab row rather than take its own full-width card. Same YearMonths
 * value/onChange contract as YearMonthsPicker (the full-row variant used by
 * Sales Report and Cost Centre Costing) — pick whichever placement a given
 * report's layout calls for, both read/write the same shape. An as-at
 * report turns this into a single date with asOfFromYearMonths() instead of
 * keeping a separate date box.
 */
export default function PeriodDropdown({ value, onChange }: { value: YearMonths; onChange: (v: YearMonths) => void }) {
  const [open, setOpen] = useState(false);
  const allOn = value.months.length === 12;
  const toggleMonth = (m: number) => {
    const has = value.months.includes(m);
    const next = has ? value.months.filter((x) => x !== m) : [...value.months, m];
    if (next.length > 0) onChange({ ...value, months: next.sort((a, b) => a - b) });
  };

  return (
    <div className="relative print:hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 text-sm font-semibold text-brand-700 hover:bg-brand-100">
        <Icon name="clock" size={14} />
        {periodLabel(value)}
        <Icon name="chevronDown" size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1.5 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-pop">
            <div className="mb-3 flex items-center justify-between">
              <span className="label mb-0">Year</span>
              <div className="flex items-center gap-1.5">
                <button className="btn-outline h-7 w-7 p-0 text-sm" onClick={() => onChange({ ...value, year: value.year - 1 })} aria-label="Previous year">‹</button>
                <span className="w-12 text-center text-sm font-bold tabular-nums text-slate-800">{value.year}</span>
                <button className="btn-outline h-7 w-7 p-0 text-sm" onClick={() => onChange({ ...value, year: value.year + 1 })} aria-label="Next year">›</button>
              </div>
            </div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="label mb-0">Months</span>
              <button onClick={() => onChange({ ...value, months: allOn ? [] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${allOn ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                All
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {MONTH_LABELS.map((label, i) => {
                const m = i + 1;
                const on = value.months.includes(m);
                return (
                  <button key={m} onClick={() => toggleMonth(m)}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${on ? "bg-brand-100 text-brand-700" : "bg-slate-50 text-slate-400 hover:bg-slate-100"}`}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
