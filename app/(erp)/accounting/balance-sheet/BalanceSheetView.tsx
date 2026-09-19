"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, dateStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import ReportKpi from "@/components/reports/ReportKpi";
import SectionHeader from "@/components/reports/SectionHeader";
import DonutChart from "@/components/reports/charts/DonutChart";
import DataTable, { type DataGroup } from "@/components/reports/DataTable";
import { defaultYearMonths, asOfFromYearMonths, type YearMonths } from "@/lib/reports/period";
import type { Col } from "@/lib/reports/types";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const COLS: Col[] = [
  { key: "label", label: "Account", href: (row) => row.href },
  { key: "amount", label: "Amount", kind: "money", total: true },
];

type Acct = { id: string; name: string; subtype: string | null; amt: number };

// Classified by the account's own subtype — real data the user set on the
// account editor (New Account / the account tree), never inferred. Assets
// split cleanly because "Current Asset"/"Fixed Asset" are subtypes accounts
// already carry; Liabilities has no Current/Long-term subtype anywhere in
// this chart (only Payable and Tax are used), so it stays split by what IS
// there rather than inventing a distinction the data doesn't hold — an
// account with nothing entered lands in its side's own "Other" bucket
// instead of being silently assumed current.
function classifyAsset(subtype: string | null): string {
  if (subtype === "Fixed Asset" || subtype === "Accumulated Depreciation") return "Fixed Assets";
  if (subtype === "Cash" || subtype === "Bank" || subtype === "Receivable" || subtype === "Current Asset" || subtype === "Tax") return "Current Assets";
  return "Other Assets";
}
function classifyLiability(subtype: string | null): string {
  if (subtype === "Payable") return "Payables";
  if (subtype === "Tax") return "Tax Payable";
  return "Other Liabilities";
}
function classifyEquity(subtype: string | null): string {
  if (subtype === "Drawing") return "Drawings";
  if (subtype === "Equity") return "Capital & Reserves";
  return "Other Equity";
}

function buildGroups(
  accts: Acct[],
  order: string[],
  classify: (subtype: string | null) => string,
  extra?: { group: string; label: string; amt: number },
): DataGroup[] {
  const byGroup = new Map<string, Acct[]>();
  for (const a of accts) {
    const g = classify(a.subtype);
    (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(a);
  }
  const groups: DataGroup[] = [];
  for (const g of order) {
    const items = byGroup.get(g) ?? [];
    const hasExtra = extra?.group === g;
    if (items.length === 0 && !hasExtra) continue;
    const total = items.reduce((s, a) => s + a.amt, 0) + (hasExtra ? extra!.amt : 0);
    const rows = items.map((a) => ({ label: a.name, amount: a.amt, href: `/accounting/ledger?account=${a.id}` }));
    if (hasExtra) rows.push({ label: extra!.label, amount: extra!.amt, href: undefined as any });
    groups.push({ key: g, label: g, values: { amount: total }, rows });
  }
  return groups;
}

function totalOf(groups: DataGroup[]): number {
  return groups.reduce((s, g) => s + Number(g.values!.amount), 0);
}

// Classified Balance Sheet, reached from the dashboard's Balance Sheet
// card — always cumulative since inception (p_from stays null; a balance
// sheet is a snapshot, not a period's movement), only the AS-AT date
// changes. Year+Months resolves to that one date via asOfFromYearMonths()
// (the last day of the latest month picked, capped at today).
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
  const assets: Acct[] = rows.filter((r) => r.nature === "asset").map((r) => ({ id: r.id, name: r.name, subtype: r.subtype, amt: net(r) })).filter((r) => r.amt);
  const liabilities: Acct[] = rows.filter((r) => r.nature === "liability").map((r) => ({ id: r.id, name: r.name, subtype: r.subtype, amt: -net(r) })).filter((r) => r.amt);
  const equity: Acct[] = rows.filter((r) => r.nature === "equity" || r.nature === "control").map((r) => ({ id: r.id, name: r.name, subtype: r.subtype, amt: -net(r) })).filter((r) => r.amt);
  const earnings = -rows.filter((r) => r.nature === "income" || r.nature === "expense").reduce((s, r) => s + net(r), 0);

  const assetGroups = buildGroups(assets, ["Current Assets", "Fixed Assets", "Other Assets"], classifyAsset);
  const liabGroups = buildGroups(liabilities, ["Payables", "Tax Payable", "Other Liabilities"], classifyLiability);
  const equityGroups = buildGroups(equity, ["Capital & Reserves", "Drawings", "Other Equity"], classifyEquity,
    { group: "Capital & Reserves", label: "Current-year earnings", amt: earnings });

  const totA = totalOf(assetGroups);
  const totL = totalOf(liabGroups);
  const totE = totalOf(equityGroups);
  const off = totA - (totL + totE);
  const balanced = Math.abs(off) < 0.01;

  const assetComposition = assetGroups.map((g) => ({ name: g.label, value: Number(g.values!.amount) }));
  const financingMix = [
    { name: "Liabilities", value: totL },
    { name: "Equity", value: totE },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={`Balance Sheet — as at ${dateStr(asOf)}`}>
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <ReportKpi label="Total Assets" value={money(totA)} icon="accounting" tone="info" />
        <ReportKpi label="Total Liabilities" value={money(totL)} icon="receipt" />
        <ReportKpi label="Total Equity" value={money(totE)} icon="wallet" tone={totE >= 0 ? "pos" : "neg"} />
        <ReportKpi label="Current-year Earnings" value={money(earnings)} icon="trendUp" tone={earnings >= 0 ? "pos" : "neg"} />
        <ReportKpi label="Books" value={balanced ? "Balanced" : `Off by ${money(Math.abs(off))}`} icon="check" tone={balanced ? "pos" : "neg"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-slate-200 shadow-card">
          <div className="bg-brand-700 px-3 py-2 text-sm font-bold text-white">Assets</div>
          <DataTable bare cols={COLS} groups={assetGroups} empty="No asset balances as at this date." />
          <div className={`flex items-center justify-between border-t border-slate-200 px-3 py-2 text-sm font-bold ${totA < 0 ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-800"}`}>
            <span>Total Assets</span><span className="tabular-nums">{money(totA)}</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-slate-200 shadow-card">
            <div className="bg-brand-700 px-3 py-2 text-sm font-bold text-white">Liabilities</div>
            <DataTable bare cols={COLS} groups={liabGroups} empty="No liability balances as at this date." />
            <div className={`flex items-center justify-between border-t border-slate-200 px-3 py-2 text-sm font-bold ${totL < 0 ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-800"}`}>
              <span>Total Liabilities</span><span className="tabular-nums">{money(totL)}</span>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200 shadow-card">
            <div className="bg-brand-700 px-3 py-2 text-sm font-bold text-white">Equity</div>
            <DataTable bare cols={COLS} groups={equityGroups} empty="No equity balances as at this date." />
            <div className={`flex items-center justify-between border-t border-slate-200 px-3 py-2 text-sm font-bold ${totE < 0 ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-800"}`}>
              <span>Total Equity</span><span className="tabular-nums">{money(totE)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 print:hidden">
        <div className="card">
          <SectionHeader title="Asset Composition" />
          <DonutChart data={assetComposition} nameKey="name" valueKey="value" height={220} />
        </div>
        <div className="card">
          <SectionHeader title="Financing Mix" />
          <DonutChart data={financingMix} nameKey="name" valueKey="value" height={220} />
        </div>
      </div>
    </div>
  );
}
