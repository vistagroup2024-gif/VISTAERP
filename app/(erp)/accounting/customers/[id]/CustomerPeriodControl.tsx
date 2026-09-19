"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import { monthRanges, type YearMonths } from "@/lib/reports/period";

// Recent Transactions had no way to look at anything but a hard-coded
// "this year to today" window, even though report_transactions() (the same
// RPC Transactions Report already exposes a period control for) has always
// taken p_from/p_to. A date window is nested, not combinable, so this is the
// single-select PeriodDropdown every other period report already uses — not
// a toggle group.
export default function CustomerPeriodControl({ initial }: { initial: YearMonths }) {
  const router = useRouter();
  const [ym, setYm] = useState<YearMonths>(initial);

  function change(next: YearMonths) {
    setYm(next);
    const ranges = monthRanges(next);
    const from = ranges[0]?.from ?? `${next.year}-01-01`;
    const to = ranges[ranges.length - 1]?.to ?? `${next.year}-12-31`;
    const p = new URLSearchParams();
    p.set("from", from);
    p.set("to", to);
    router.push(`?${p.toString()}`);
  }

  return <PeriodDropdown value={ym} onChange={change} />;
}
