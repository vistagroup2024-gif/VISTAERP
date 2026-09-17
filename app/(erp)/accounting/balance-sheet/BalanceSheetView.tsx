"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, dateStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import { defaultYearMonths, asOfFromYearMonths, type YearMonths } from "@/lib/reports/period";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function Section({ title, rows, extra }: { title: string; rows: any[]; extra?: { name: string; amt: number } }) {
  return (
    <div className="card overflow-x-auto p-0">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-semibold text-slate-700">{title}</div>
      <table className="w-full text-sm"><tbody>
        {rows.map((r) => (<tr key={r.id} className="border-b border-slate-50">
          <td className="px-4 py-1.5"><Link href={`/accounting/ledger?account=${r.id}`} className="hover:text-brand hover:underline">{r.name}</Link></td>
          <td className="px-4 py-1.5 text-right tabular-nums">{money(r.amt)}</td>
        </tr>))}
        {extra && <tr className="border-b border-slate-50"><td className="px-4 py-1.5 italic text-slate-600">{extra.name}</td><td className="px-4 py-1.5 text-right tabular-nums">{money(extra.amt)}</td></tr>}
      </tbody></table>
    </div>
  );
}

// Balance Sheet — always cumulative since inception (p_from stays null; a
// balance sheet is a snapshot, not a period's movement), only the AS-AT
// date changes. Year+Months resolves to that one date via
// asOfFromYearMonths() (the last day of the latest month picked, capped at
// today) instead of its own date box.
export default function BalanceSheetView() {
  const sb = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);
  const [rows, setRows] = useState<any[]>([]);

  const asOf = asOfFromYearMonths(ym);

  useEffect(() => {
    let live = true;
    sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: null, p_to: asOf }).then(({ data }) => {
      if (live) setRows((data as any[]) ?? []);
    });
    return () => { live = false; };
  }, [sb, asOf]);

  const net = (r: any) => Number(r.closing_net);
  const assets = rows.filter((r) => r.nature === "asset").map((r) => ({ ...r, amt: net(r) })).filter((r) => r.amt);
  const liabilities = rows.filter((r) => r.nature === "liability").map((r) => ({ ...r, amt: -net(r) })).filter((r) => r.amt);
  const equity = rows.filter((r) => r.nature === "equity" || r.nature === "control").map((r) => ({ ...r, amt: -net(r) })).filter((r) => r.amt);
  const earnings = -rows.filter((r) => r.nature === "income" || r.nature === "expense").reduce((s, r) => s + net(r), 0);

  const totA = assets.reduce((s, r) => s + r.amt, 0);
  const totL = liabilities.reduce((s, r) => s + r.amt, 0);
  const totE = equity.reduce((s, r) => s + r.amt, 0) + earnings;
  const balanced = Math.abs(totA - (totL + totE)) < 0.01;

  return (
    <div className="space-y-4">
      <PageHeader title={`Balance Sheet — as at ${dateStr(asOf)}`}>
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>
      <div className="card flex items-center">
        <span className={`ml-auto rounded-full px-3 py-1 text-sm font-medium ${balanced ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {balanced ? "Balanced ✓" : `Off by ${money(Math.abs(totA - (totL + totE)))}`}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title={`Assets — ${money(totA)}`} rows={assets} />
        <div className="space-y-4">
          <Section title={`Liabilities — ${money(totL)}`} rows={liabilities} />
          <Section title={`Equity — ${money(totE)}`} rows={equity} extra={{ name: "Current-year earnings", amt: earnings }} />
        </div>
      </div>
    </div>
  );
}
