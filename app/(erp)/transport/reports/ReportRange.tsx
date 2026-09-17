"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import { defaultYearMonths, monthRanges, type YearMonths } from "@/lib/reports/period";

// The period control sits in the title row now (PageHeader's children),
// beside Trip Ledger / Print — no separate From/To row of its own.
// Applying navigates via router.push the same way the old Apply button
// did; this page's own data fetch (RPCs + the raw expenses/ratings
// queries) stays server-side, untouched.
export default function ReportRange() {
  const router = useRouter();
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);

  function apply(next: YearMonths) {
    setYm(next);
    const ranges = monthRanges(next);
    const f = ranges[0]?.from ?? `${next.year}-01-01`;
    const t = ranges[ranges.length - 1]?.to ?? `${next.year}-12-31`;
    router.push(`/transport/reports?from=${f}&to=${t}`);
  }

  return <PeriodDropdown value={ym} onChange={apply} />;
}
